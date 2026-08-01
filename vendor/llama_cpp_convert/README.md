Vendored from [llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT
licensed, see LICENSE in this directory): `convert_hf_to_gguf.py` plus its
`conversion/` and `gguf-py/gguf/` support packages, used by `fine_tune.py`
to turn a merged, fine-tuned Hugging Face model back into the GGUF format
`local_ai.py` serves. Not modified from upstream. Update by re-copying
these same paths from a fresh checkout of the llama.cpp repo.
