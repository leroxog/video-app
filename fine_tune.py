"""Real fine-tuning of NexAI's local chat model (see local_ai.py) on
admin-curated instruction/response examples (models.py's
AiTrainingExample) -- this actually changes the served model's weights,
unlike AiLearnedFact's prompt-injection "learning". LoRA training on CPU
via transformers+peft, then merged and converted back into the GGUF
format local_ai.py serves, using the vendored llama.cpp conversion script
(see vendor/llama_cpp_convert/).

Heavy dependencies (torch, transformers, peft) are imported lazily inside
run_training_job(), not at module import time, so simply importing this
module (e.g. app.py checking whether a run is in progress) never loads
them into a process that isn't actually training.

Genuinely slow and resource-heavy on this app's CPU-only hosting -- a
real training run can take anywhere from minutes to hours depending on
how many examples are curated, and competes for the same CPU the live
chat feature runs on for its duration (chat replies will be noticeably
slower while a training run is active). Meant to be triggered rarely, by
an admin, from app.py's admin training page -- never exposed to regular
users, and app.py is responsible for ensuring only one run happens at a
time."""
import os
import sys
import logging
import subprocess

logger = logging.getLogger(__name__)

BASE_MODEL_ID = "Qwen/Qwen2.5-1.5B-Instruct"
EPOCHS = 3
MAX_EXAMPLE_TOKENS = 512
LEARNING_RATE = 1e-4

VENDOR_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor", "llama_cpp_convert")
CONVERT_SCRIPT = os.path.join(VENDOR_DIR, "convert_hf_to_gguf.py")


def run_training_job(examples, work_dir, on_status=None):
    """examples: a list of (instruction, response) string tuples.
    work_dir: an existing, empty scratch directory for intermediate files
    (the caller owns cleanup). on_status(message), if given, is called
    with short human-readable progress updates as training proceeds.
    Returns the path to the final, quantized GGUF file on success; raises
    on any failure (base-model download, training, conversion, or
    quantization)."""
    def status(message):
        logger.info("Training: %s", message)
        if on_status:
            on_status(message)

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import LoraConfig, get_peft_model, TaskType

    status("Lade Basis-Modell...")
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL_ID)
    model = AutoModelForCausalLM.from_pretrained(BASE_MODEL_ID, dtype=torch.float32)

    lora_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM, r=8, lora_alpha=16, lora_dropout=0.05,
        target_modules=["q_proj", "v_proj"],
    )
    model = get_peft_model(model, lora_config)
    model.train()

    optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE)
    total_steps = EPOCHS * len(examples)
    step = 0
    status(f"Starte Training ({len(examples)} Beispiele, {EPOCHS} Durchläufe, {total_steps} Schritte)...")
    for _epoch in range(EPOCHS):
        for instruction, response in examples:
            text = tokenizer.apply_chat_template(
                [{"role": "user", "content": instruction}, {"role": "assistant", "content": response}],
                tokenize=False,
            )
            inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=MAX_EXAMPLE_TOKENS)
            inputs["labels"] = inputs["input_ids"].clone()
            outputs = model(**inputs)
            outputs.loss.backward()
            optimizer.step()
            optimizer.zero_grad()
            step += 1
            if step % 5 == 0 or step == total_steps:
                status(f"Trainingsschritt {step}/{total_steps} (Fehlerwert {outputs.loss.item():.3f})")

    status("Führe trainierte Anpassungen zusammen...")
    merged = model.merge_and_unload()
    merged_dir = os.path.join(work_dir, "merged")
    merged.save_pretrained(merged_dir, safe_serialization=True)
    tokenizer.save_pretrained(merged_dir)

    status("Wandle Modell ins GGUF-Format um...")
    gguf_f16_path = os.path.join(work_dir, "model-f16.gguf")
    result = subprocess.run(
        [sys.executable, CONVERT_SCRIPT, merged_dir, "--outfile", gguf_f16_path, "--outtype", "f16"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"GGUF-Konvertierung fehlgeschlagen: {result.stderr[-2000:]}")

    status("Quantisiere Modell für den Betrieb...")
    import llama_cpp
    import ctypes
    quantized_path = os.path.join(work_dir, "model-q4.gguf")
    params = llama_cpp.llama_model_quantize_default_params()
    params.ftype = llama_cpp.LLAMA_FTYPE_MOSTLY_Q4_K_M
    return_code = llama_cpp.llama_model_quantize(
        gguf_f16_path.encode("utf-8"), quantized_path.encode("utf-8"), ctypes.byref(params),
    )
    if return_code != 0:
        raise RuntimeError(f"Quantisierung fehlgeschlagen (Code {return_code}).")

    status("Training abgeschlossen.")
    return quantized_path
