/**
 * Minimal polyfills for DOM APIs required by pdfjs-dist in Node.js.
 *
 * pdfjs-dist v5 evaluates `new DOMMatrix()` at module load time (in its
 * canvas helper), which throws in Node.js.  Since we only use pdfjs for
 * parsing (page count, TOC) — not rendering — these stubs are sufficient.
 *
 * This file MUST be imported before any `pdfjs-dist` import.
 */

if (typeof globalThis.DOMMatrix === "undefined") {
  // DOMMatrix stub — supports identity matrix and basic transform storage
  globalThis.DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true; isIdentity = true;

    constructor(init?: number[] | string) {
      if (Array.isArray(init) && init.length === 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
        this.m11 = this.a; this.m12 = this.b;
        this.m21 = this.c; this.m22 = this.d;
        this.m41 = this.e; this.m42 = this.f;
        this.isIdentity = false;
      }
    }

    inverse() { return new DOMMatrix(); }
    multiply() { return new DOMMatrix(); }
    translate() { return new DOMMatrix(); }
    scale() { return new DOMMatrix(); }
    rotate() { return new DOMMatrix(); }
    transformPoint() { return { x: 0, y: 0, z: 0, w: 1 }; }
  } as unknown as typeof globalThis.DOMMatrix;
}

if (typeof globalThis.Path2D === "undefined") {
  globalThis.Path2D = class Path2D {
    moveTo() {}
    lineTo() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    arc() {}
    arcTo() {}
    ellipse() {}
    rect() {}
    closePath() {}
    addPath() {}
  } as unknown as typeof globalThis.Path2D;
}

if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    colorSpace = "srgb" as const;

    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  } as unknown as typeof globalThis.ImageData;
}
