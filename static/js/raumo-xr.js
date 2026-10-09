/* raumo xr: scanning by walking, on phones whose browser offers WebXR with depth (Android with Chrome and ARCore).  The phone keeps track
   of where it is (that is what ARCore does), reports a picture of distances and, with "camera access", the colours it sees.  raumo turns
   them into points (see raumo-cloud.js) and draws the points over the camera picture while you walk.

   Two parts: FrameProcessor (no screen, no WebXR objects needed: it takes what a frame gives and makes points; the tests drive it with
   made-up frames) and XRWalk (the session, the drawing, reading the camera colours).  iPhones do not offer WebXR in Safari, so this
   cannot run there. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./raumo-core.js"), require("./raumo-cloud.js"));
  else root.RaumoXR = factory(root.RaumoCore, root.RaumoCloud);
})(typeof self !== "undefined" ? self : this, function (Core, Cloud) {
  "use strict";

  /* The camera of a WebXR view as the cloud code wants it: where it is, where it looks, how wide it sees.  `view.transform.matrix`
     takes camera coordinates to world coordinates (column major; the lens looks along -z), `view.projectionMatrix` is the usual
     OpenGL projection (its [0] and [5] hold 1 / tan of half the field of view; [8] and [9] move the middle). */
  function cameraFromView(view) {
    const m = view.transform.matrix, p = view.projectionMatrix;
    return {
      position: [m[12], m[13], m[14]],
      right: [m[0], m[1], m[2]],
      up: [m[4], m[5], m[6]],
      forward: [-m[8], -m[9], -m[10]],
      tanX: 1 / p[0], tanY: 1 / p[5], cx: p[8] || 0, cy: p[9] || 0,
    };
  }

  /* A picture of distances in metres, `width` x `height`, from what WebXR gives: `info.getDepthInMeters(u, v)` takes a place in the view
     (0..1, from the top left corner of the picture). Unknown readings become 0.  With `flipY` the picture is read upside down (in case a
     device counts from the bottom). */
  function depthGrid(info, width, height, flipY = false) {
    const data = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      const v = flipY ? 1 - (y + 0.5) / height : (y + 0.5) / height;
      for (let x = 0; x < width; x++) {
        let d = 0;
        try { d = info.getDepthInMeters((x + 0.5) / width, v); } catch (error) { d = 0; }
        data[y * width + x] = Number.isFinite(d) && d > 0 ? d : 0;
      }
    }
    return { width, height, data };
  }

  /* Takes frames, makes points. `options`: size (cube side), minHits, near, far, flipDepthY, depthWidth. */
  class FrameProcessor {
    constructor(options = {}) {
      this.options = { size: Cloud.SPACING, minHits: 2, near: 0.35, far: 4.5, depthLong: 64, ...options };
      this.capture = new Cloud.WalkCapture({ size: this.options.size, minHits: this.options.minHits, near: this.options.near, far: this.options.far, stride: 1, edge: 0.08 });
      this.frames = 0;
      this.withoutDepth = 0;
    }

    /* `view` as WebXR gives it, `depthInfo` (or null), `color` ({width, height, data} RGBA, row 0 on top) or null.
       Returns how many readings were used. */
    process(view, depthInfo, color) {
      this.frames += 1;
      if (!depthInfo) { this.withoutDepth += 1; return 0; }
      const camera = cameraFromView(view);
      const wide = camera.tanX >= camera.tanY;
      const long = this.options.depthLong, short = Math.max(8, Math.round(long * Math.min(camera.tanX, camera.tanY) / Math.max(camera.tanX, camera.tanY)));
      const depth = depthGrid(depthInfo, wide ? long : short, wide ? short : long, !!this.options.flipDepthY);
      return this.capture.addFrame({ camera, depth, color });
    }

    takeNew() { return this.capture.takeNew(); }
    get count() { return this.capture.count; }

    /* The finished cloud, with its floor at height zero. */
    finish() {
      const cloud = this.capture.toCloud();
      return Cloud.alignFloor(cloud).cloud;
    }
  }

  // ------------------------------------------------------------------------------------- the session (browser)
  const COLOR_VERTEX = "attribute vec2 p; varying vec2 t; void main() { t = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }";
  const COLOR_FRAGMENT = "precision mediump float; uniform sampler2D tex; uniform float flip; varying vec2 t; void main() { gl_FragColor = vec4(texture2D(tex, vec2(t.x, flip > 0.5 ? 1.0 - t.y : t.y)).rgb, 1.0); }";

  /* Reads the colours of the camera picture into a small array. */
  class ColorReader {
    constructor(gl, width = 96, height = 54) {
      this.gl = gl; this.width = width; this.height = height;
      const compile = (type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); return s; };
      this.program = gl.createProgram();
      gl.attachShader(this.program, compile(gl.VERTEX_SHADER, COLOR_VERTEX));
      gl.attachShader(this.program, compile(gl.FRAGMENT_SHADER, COLOR_FRAGMENT));
      gl.linkProgram(this.program);
      this.loc = { p: gl.getAttribLocation(this.program, "p"), tex: gl.getUniformLocation(this.program, "tex"), flip: gl.getUniformLocation(this.program, "flip") };
      this.quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
      this.pixels = new Uint8Array(width * height * 4);
      this.out = new Uint8ClampedArray(width * height * 4);
    }

    /* `camera` is the WebGLTexture of the camera picture; `restore` is the framebuffer to bind afterwards. With `flipY` the picture is read
       upside down. Returns {width, height, data} with row 0 at the top. */
    read(camera, restore, flipY) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, this.width, this.height);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
      gl.useProgram(this.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, camera);
      gl.uniform1i(this.loc.tex, 0);
      gl.uniform1f(this.loc.flip, flipY ? 1 : 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.enableVertexAttribArray(this.loc.p);
      gl.vertexAttribPointer(this.loc.p, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disableVertexAttribArray(this.loc.p);
      gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
      gl.bindFramebuffer(gl.FRAMEBUFFER, restore);
      gl.enable(gl.DEPTH_TEST);
      const w = this.width, h = this.height;
      for (let y = 0; y < h; y++) this.out.set(this.pixels.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);          // readPixels starts at the bottom
      return { width: w, height: h, data: this.out };
    }
  }

  /* A walk with the phone's own tracking.  `viewer` is a RaumoGL.Viewer made with {xr: true}; `overlay` the element with the buttons
     (shown on top of the camera picture); callbacks: onUpdate({points, frames}), onEnd(cloud), onProblem(text). */
  class XRWalk {
    static async supported() {
      try { return !!(navigator.xr && (await navigator.xr.isSessionSupported("immersive-ar"))); } catch (error) { return false; }
    }

    constructor({ viewer, overlay, onUpdate, onEnd, onProblem, flipDepthY = false, flipColorY = false }) {
      this.viewer = viewer; this.overlay = overlay;
      this.onUpdate = onUpdate || (() => {}); this.onEnd = onEnd || (() => {}); this.onProblem = onProblem || (() => {});
      this.processor = new FrameProcessor({ flipDepthY });
      this.flipColorY = flipColorY;
      this.last = 0;
      this.ended = false;
      this.hasColor = false;
    }

    async start() {
      const gl = this.viewer.gl;
      if (gl.makeXRCompatible) await gl.makeXRCompatible();
      const init = { requiredFeatures: ["local"], optionalFeatures: ["local-floor", "depth-sensing", "camera-access", "dom-overlay"],
        depthSensing: { usagePreference: ["cpu-optimized", "gpu-optimized"], dataFormatPreference: ["luminance-alpha", "float32"] } };
      if (this.overlay) init.domOverlay = { root: this.overlay };
      this.session = await navigator.xr.requestSession("immersive-ar", init);
      const features = this.session.enabledFeatures || [];
      this.hasDepth = features.length ? features.includes("depth-sensing") : !!this.session.depthUsage;
      this.wantsColor = features.length ? features.includes("camera-access") : false;
      if (!this.hasDepth) { this.finish(); throw new Error("Dieses Handy oder dieser Browser liefert keine Tiefendaten (WebXR Depth Sensing)."); }
      this.layer = new XRWebGLLayer(this.session, gl, { alpha: true, antialias: false });
      this.session.updateRenderState({ baseLayer: this.layer });
      this.binding = this.wantsColor && typeof XRWebGLBinding !== "undefined" ? new XRWebGLBinding(this.session, gl) : null;
      this.colors = this.binding ? new ColorReader(gl) : null;
      try { this.space = await this.session.requestReferenceSpace("local-floor"); this.floorKnown = true; } catch (error) { this.space = await this.session.requestReferenceSpace("local"); this.floorKnown = false; }
      this.session.addEventListener("end", () => this.finish());
      this.session.requestAnimationFrame((t, f) => this.frame(t, f));
      this.viewer.pointTint = [0.2, 0.9, 1.0, 0.35];
    }

    stop() { if (this.session && !this.ended) this.session.end().catch(() => this.finish()); else this.finish(); }

    frame(time, frame) {
      if (this.ended) return;
      this.session.requestAnimationFrame((t, f) => this.frame(t, f));
      const pose = frame.getViewerPose(this.space);
      if (!pose || !pose.views.length) return;
      const view = pose.views[0];
      if (time - this.last >= 110) {
        this.last = time;
        let info = null;
        try { info = frame.getDepthInformation(view); } catch (error) { info = null; }
        let color = null;
        if (this.colors && view.camera) {
          try { color = this.colors.read(this.binding.getCameraImage(view.camera), this.layer.framebuffer, this.flipColorY); this.hasColor = true; } catch (error) { color = null; }
        }
        this.processor.process(view, info, color);
        const points = this.processor.takeNew();
        if (points.length) this.viewer.appendPoints("walk", color ? points : points.map((p) => ({ ...p, ...heightColor(p.y) })));
        if (this.processor.withoutDepth > 40 && this.processor.count === 0 && !this.warned) { this.warned = true; this.onProblem("Das Handy liefert keine Tiefendaten. Bewege es langsam und richte es auf Wände und Boden."); }
        this.onUpdate({ points: this.processor.count, frames: this.processor.frames, color: this.hasColor });
      }
      this.viewer.drawXR(view, this.layer);
    }

    finish() {
      if (this.ended) return;
      this.ended = true;
      this.viewer.pointTint = null;
      this.onEnd(this.processor.finish(), { floorKnown: this.floorKnown, color: this.hasColor });
    }
  }

  const heightColor = (y) => { const t = Math.max(0, Math.min(1, y / 2.5)); return { r: 60 + 190 * t, g: 160 + 60 * (1 - Math.abs(t - 0.5) * 2), b: 255 - 200 * t }; };

  return { cameraFromView, depthGrid, FrameProcessor, ColorReader, XRWalk };
});
