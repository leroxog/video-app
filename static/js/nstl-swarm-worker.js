/* The worker that runs the agent swarm (nstl-swarm-core.js) off the page's own thread, so the browser stays responsive while several
   million agents talk to each other.  It never fetches anything itself: the page already asked Wikipedia and hands the worker only the
   candidates' measured properties (numbers, not the text) and gets back numbers (who is leading, how well the swarm understands itself,
   a sample of the talks) until it is done or the page tells it to stop. */
importScripts("nstl-swarm-core.js");

let swarm = null;
let stop = false;

function sleep0() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function run(job) {
  const { width, height, features, types, radius, longDistance, seed, maxRounds, maxMs, keep } = job;
  swarm = NstlSwarm.create({ width, height, features, types, radius, longDistance, seed });
  const started = Date.now();
  let m = NstlSwarm.measure(swarm);
  postMessage({ type: "progress", measure: m, events: [] });
  for (let round = 0; round < maxRounds && !stop; round++) {
    const { events } = NstlSwarm.step(swarm, { keep });
    m = NstlSwarm.measure(swarm);
    for (const e of events) { e.wordText = NstlSwarm.wordText(e.word); e.heardText = NstlSwarm.wordText(e.heard); }
    postMessage({ type: "progress", measure: m, events });
    if (NstlSwarm.agreed(m) || Date.now() - started > maxMs) break;
    await sleep0();                                                   // gives the worker's queue a chance to deliver a "stop" before the next round
  }
  postMessage({ type: "done", measure: m, agreed: NstlSwarm.agreed(m), ms: Date.now() - started });
}

onmessage = (event) => {
  const data = event.data;
  if (data.type === "start") { stop = false; run(data).catch((error) => postMessage({ type: "error", message: String(error && error.message || error) })); }
  else if (data.type === "stop") stop = true;
  else if (data.type === "paint" && swarm) {
    const { columns, rows, mode } = data;
    const image = { data: new Uint8ClampedArray(columns * rows * 4) };
    NstlSwarm.paint(swarm, image, columns, rows, mode);
    postMessage({ type: "paint", columns, rows, mode, pixels: image.data }, [image.data.buffer]);
  }
};
