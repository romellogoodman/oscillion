import { useCallback, useEffect, useRef, useState } from "react";
import "./App.scss";

import {
  MAX_INKS,
  RISO_COMBOS,
  RISO_INKS,
  createExposure,
  describe,
  downloadCanvas,
  drawExposureTile,
  fileBase,
  hexToReflect,
  makeMapper,
  parseSeedHex,
  pickDistinctSeeds,
  proofMap,
  randomSeed,
  samplesForSize,
  seedHex,
  toneMap,
} from "./engine/oscillon-engine.ts";

/*
  OSCILLON — after Ben Laposky (1914–2000)

  The demo site: one exposure at a time, slowly developing on a black
  phosphor screen. Click for a new piece. The seed in the caption IS
  the piece — the same seed always redevelops the identical figure,
  here, in the CLI, and anywhere else the shared engine runs.

  All beam physics live in src/engine/oscillon-engine.ts; this file is
  only the screen: composite loop, recipe hash, and controls.
*/

const VIEW_SIZE = 1200; // on-screen exposure resolution (px)
const DEVELOP_SECONDS = 12; // how long an exposure takes to bloom
const PAPER_HEX = "#faf8f3";
const PAPER = hexToReflect(PAPER_HEX);

// hash carries the whole recipe: #<seed>[,<seed>...][/<ink>,<ink>...]
// one seed = a single exposure; 4 or 16 seeds = a contact sheet
function buildHash(seeds, inkSel) {
  return `#${seeds.map(seedHex).join(",")}${
    inkSel.length ? "/" + inkSel.join(",") : ""
  }`;
}

function parseHash(hash) {
  const m = /^#([0-9a-f]{1,8}(?:,[0-9a-f]{1,8})*)(?:\/(\d+(?:,\d+)*))?$/i.exec(
    hash
  );
  if (!m) return null;
  const seeds = m[1]
    .split(",")
    .map((part) => parseSeedHex(part))
    .filter((v) => v !== null);
  const inks = [];
  if (m[2]) {
    for (const part of m[2].split(",")) {
      const idx = parseInt(part, 10);
      if (
        idx >= 0 &&
        idx < RISO_INKS.length &&
        !inks.includes(idx) &&
        inks.length < MAX_INKS
      ) {
        inks.push(idx);
      }
    }
  }
  return seeds.length ? { seeds, inks } : null;
}

// grid size implied by how many seeds the hash carries
const gridForSeeds = (count) => (count >= 16 ? "4" : count >= 4 ? "2" : "1");

// square phosphor composite of the current buffers, for PNG saves
function compositeSquare(mapper, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "lighter";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(mapper.core.canvas, 0, 0, size, size);
  ctx.drawImage(mapper.glow.canvas, 0, 0, size, size);
  return canvas;
}

// ----------------------------------------------------------------- the app

function App() {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const engineRef = useRef(null);
  const mapperRef = useRef(null);
  const seedRef = useRef(0);
  const rafRef = useRef(0);

  const [info, setInfo] = useState(null);
  const [progress, setProgress] = useState(0);

  // the demo site defaults to the black phosphor view; paper stays a toggle
  const [proof, setProof] = useState(false);
  const [grid, setGrid] = useState(() =>
    gridForSeeds(parseHash(window.location.hash)?.seeds.length ?? 1)
  );

  const inkSelRef = useRef(parseHash(window.location.hash)?.inks ?? []);
  const proofRef = useRef(false);
  const gridRef = useRef(grid);
  const cellsRef = useRef(null); // contact-sheet exposures when grid > 1
  const lastHashRef = useRef("");
  const clickTimerRef = useRef(0);

  // draw one exposure (phosphor or proof) into a square region
  const drawTile = useCallback((ctx, exp, mapper, x, y, size) => {
    drawExposureTile(
      ctx,
      exp,
      mapper,
      x,
      y,
      size,
      proofRef.current ? "paper" : "phosphor",
      PAPER
    );
  }, []);

  const drawScene = useCallback(
    (ctx, w, h) => {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.fillStyle = proofRef.current ? PAPER_HEX : "#000";
      ctx.fillRect(0, 0, w, h);
      const side = Math.min(w, h);
      const ox = (w - side) / 2;
      const oy = (h - side) / 2;
      const cells = cellsRef.current;
      if (cells) {
        const n = gridRef.current;
        const gap = Math.round(side * 0.01);
        const tile = (side - gap * (n - 1)) / n;
        for (let i = 0; i < cells.length; i++) {
          drawTile(
            ctx,
            cells[i].exp,
            cells[i].mapper,
            ox + (i % n) * (tile + gap),
            oy + ((i / n) | 0) * (tile + gap),
            tile
          );
        }
        return;
      }
      const exp = engineRef.current;
      const mapper = mapperRef.current;
      if (exp && mapper) drawTile(ctx, exp, mapper, ox, oy, side);
    },
    [drawTile]
  );

  const compositeView = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    drawScene(ctx, w, h);
  }, [drawScene]);

  // the hash always mirrors what's on screen: one seed or a whole sheet
  const writeRecipeHash = useCallback(() => {
    const seeds = cellsRef.current
      ? cellsRef.current.map((c) => c.seed)
      : [seedRef.current];
    const h = buildHash(seeds, inkSelRef.current);
    lastHashRef.current = h;
    window.history.replaceState(null, "", h);
  }, []);

  const regen = useCallback(
    (seed, writeHash = true) => {
      cellsRef.current = null;
      if (gridRef.current !== 1) {
        gridRef.current = 1;
        setGrid(1);
      }
      seedRef.current = seed >>> 0;
      if (writeHash) writeRecipeHash();
      const inks = inkSelRef.current.map((idx) => RISO_INKS[idx]);
      engineRef.current = createExposure(
        seedRef.current,
        VIEW_SIZE,
        samplesForSize(VIEW_SIZE),
        inks
      );
      setInfo(describe(engineRef.current.P, seedRef.current));
      setProgress(0);
      compositeView();
    },
    [compositeView, writeRecipeHash]
  );

  // a contact sheet: n×n seeds developing at once; smaller cells and fewer
  // samples per cell keep total memory and develop time constant
  const regenSheet = useCallback(
    (seeds, writeHash = true) => {
      const n = gridRef.current;
      const count = n * n;
      const size = Math.floor(VIEW_SIZE / n);
      const inks = inkSelRef.current.map((idx) => RISO_INKS[idx]);
      const picked = seeds ?? pickDistinctSeeds(count, "any", "any");
      cellsRef.current = Array.from({ length: count }, (_, i) => {
        const seed = picked[i] ?? randomSeed();
        return {
          seed,
          exp: createExposure(seed, size, samplesForSize(size), inks),
          mapper: makeMapper(size, size >> 2),
        };
      });
      if (writeHash) writeRecipeHash();
      setInfo({ sheet: n });
      setProgress(0);
      compositeView();
    },
    [compositeView, writeRecipeHash]
  );

  // inks rotate by themselves: every new exposure or sheet advances
  // through the print-proven combos (starting point picked lazily so
  // each session begins somewhere new)
  const comboIndexRef = useRef(-1);
  const rotateInks = useCallback(() => {
    if (comboIndexRef.current < 0) {
      comboIndexRef.current = (Math.random() * RISO_COMBOS.length) | 0;
    }
    comboIndexRef.current = (comboIndexRef.current + 1) % RISO_COMBOS.length;
    inkSelRef.current = [...RISO_COMBOS[comboIndexRef.current]];
  }, []);

  const newExposure = useCallback(() => {
    rotateInks();
    if (cellsRef.current) regenSheet();
    else regen(randomSeed());
  }, [regen, regenSheet, rotateInks]);

  const cycleGrid = useCallback(() => {
    const next = gridRef.current === 1 ? 2 : gridRef.current === 2 ? 4 : 1;
    gridRef.current = next;
    setGrid(next);
    if (next === 1) regen(seedRef.current);
    else regenSheet();
  }, [regen, regenSheet]);

  // click deals a new exposure / sheet; in sheet mode we wait a beat in
  // case it's a double-click, which promotes the cell instead
  const handleCanvasClick = useCallback(() => {
    if (!cellsRef.current) {
      newExposure();
      return;
    }
    clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => regenSheet(), 260);
  }, [newExposure, regenSheet]);

  const handleCanvasDblClick = useCallback(
    (ev) => {
      const cells = cellsRef.current;
      if (!cells) return;
      clearTimeout(clickTimerRef.current);
      const rect = canvasRef.current.getBoundingClientRect();
      const side = Math.min(rect.width, rect.height);
      const ox = rect.left + (rect.width - side) / 2;
      const oy = rect.top + (rect.height - side) / 2;
      const n = gridRef.current;
      const cx = Math.floor(((ev.clientX - ox) / side) * n);
      const cy = Math.floor(((ev.clientY - oy) / side) * n);
      if (cx < 0 || cy < 0 || cx >= n || cy >= n) return;
      regen(cells[cy * n + cx].seed);
    },
    [regen]
  );

  // proof: how the current recipe prints on white stock (multiplied inks)
  const toggleProof = useCallback(() => {
    proofRef.current = !proofRef.current;
    setProof(proofRef.current);
    compositeView();
  }, [compositeView]);

  const savePng = useCallback(() => {
    if (cellsRef.current) {
      const c = document.createElement("canvas");
      c.width = VIEW_SIZE;
      c.height = VIEW_SIZE;
      drawScene(c.getContext("2d"), VIEW_SIZE, VIEW_SIZE);
      const n = gridRef.current;
      downloadCanvas(c, `oscillon-sheet-${n}x${n}.png`);
      return;
    }
    const exp = engineRef.current;
    const mapper = mapperRef.current;
    if (!exp || !mapper) return;
    if (proofRef.current) {
      proofMap(mapper, exp, PAPER);
      downloadCanvas(
        mapper.proof.canvas,
        `${fileBase(exp.P, exp.seed)}-proof.png`
      );
      return;
    }
    toneMap(mapper, exp);
    downloadCanvas(
      compositeSquare(mapper, VIEW_SIZE),
      `${fileBase(exp.P, exp.seed)}.png`
    );
  }, [drawScene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    ctxRef.current = canvas.getContext("2d");
    mapperRef.current = makeMapper(VIEW_SIZE, VIEW_SIZE >> 2);

    const parsed = parseHash(window.location.hash);
    if (parsed && gridRef.current > 1) {
      const n = gridRef.current;
      regenSheet(parsed.seeds.slice(0, n * n));
    } else {
      regen(parsed ? parsed.seeds[0] : randomSeed());
    }

    // time-based pacing: the bloom takes DEVELOP_SECONDS regardless of
    // the display's refresh rate
    let frame = 0;
    let lastTime = 0;
    const loop = (now) => {
      const dt = lastTime ? Math.min(0.1, (now - lastTime) / 1000) : 1 / 60;
      lastTime = now;
      // the proof render is heavier, refresh it less often
      const throttle = proofRef.current ? 12 : 5;
      const cells = cellsRef.current;
      if (cells) {
        const active = cells.filter((c) => c.exp.done < c.exp.total);
        if (active.length) {
          const budget = Math.max(
            1,
            Math.round((cells[0].exp.total * dt) / DEVELOP_SECONDS)
          );
          const per = Math.max(1, Math.round(budget / active.length));
          for (const c of active) c.exp.develop(per);
          frame++;
          const finished = active.every((c) => c.exp.done >= c.exp.total);
          if (frame % throttle === 0 || finished) compositeView();
          setProgress(
            Math.floor((cells[0].exp.done / cells[0].exp.total) * 100)
          );
        }
      } else {
        const exp = engineRef.current;
        if (exp && exp.done < exp.total) {
          const budget = Math.max(
            1,
            Math.round((exp.total * dt) / DEVELOP_SECONDS)
          );
          const finished = exp.develop(budget);
          frame++;
          if (frame % throttle === 0 || finished) compositeView();
          setProgress(Math.floor((exp.done / exp.total) * 100));
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    const onResize = () => compositeView();
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "s" || e.key === "S") savePng();
      else if (e.key === "p" || e.key === "P") toggleProof();
      else if (e.key === "g" || e.key === "G") cycleGrid();
      else if (
        e.key === "n" ||
        e.key === "N" ||
        (e.key === " " && e.target.tagName !== "BUTTON")
      ) {
        e.preventDefault();
        newExposure();
      }
    };
    const onHash = () => {
      const h = window.location.hash;
      if (h === lastHashRef.current) return;
      const parsed = parseHash(h);
      if (!parsed) return;
      lastHashRef.current = h;
      inkSelRef.current = parsed.inks;
      const n = gridForSeeds(parsed.seeds.length);
      if (n > 1) {
        gridRef.current = n;
        setGrid(n);
        regenSheet(parsed.seeds.slice(0, n * n), false);
      } else {
        regen(parsed.seeds[0], false);
      }
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", onHash);
    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(clickTimerRef.current);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("hashchange", onHash);
    };
  }, [
    regen,
    compositeView,
    savePng,
    newExposure,
    toggleProof,
    cycleGrid,
    regenSheet,
  ]);

  return (
    <main className={`oscillon${proof ? " oscillon--proof" : ""}`}>
      <canvas
        ref={canvasRef}
        className="oscillon__canvas"
        role="img"
        aria-label="Oscillon — a simulated oscilloscope exposure. Click for a new one."
        onClick={handleCanvasClick}
        onDoubleClick={handleCanvasDblClick}
      />
      {info?.sheet ? (
        <footer className="oscillon__caption">
          <p className="oscillon__caption-line oscillon__caption-line--title">
            Contact sheet · {info.sheet}×{info.sheet}
          </p>
        </footer>
      ) : (
        info && (
          <footer className="oscillon__caption">
            <p className="oscillon__caption-line oscillon__caption-line--title">
              Oscillon Seed. {info.seed}
            </p>
            <p className="oscillon__caption-line">{info.settings}</p>
          </footer>
        )
      )}
      <div className="oscillon__controls">
        <nav className="oscillon__controls-row" aria-label="Exposure controls">
          <button
            type="button"
            className="oscillon__button"
            onClick={newExposure}
          >
            new exposure
          </button>
          <button type="button" className="oscillon__button" onClick={savePng}>
            save png
          </button>
          <button
            type="button"
            className="oscillon__button"
            onClick={toggleProof}
            aria-pressed={proof}
            aria-label={`Background: ${proof ? "paper" : "black"}`}
          >
            bg · {proof ? "paper" : "black"}
          </button>
          <button
            type="button"
            className="oscillon__button"
            onClick={cycleGrid}
            aria-label={`Grid: ${grid === 1 ? "single" : `${grid} by ${grid}`}`}
          >
            grid · {grid === 1 ? "1" : `${grid}×${grid}`}
          </button>
        </nav>
      </div>
      <div
        className={`oscillon__progress${progress >= 100 ? " oscillon__progress--done" : ""}`}
        style={{ "--oscillon-progress": progress / 100 }}
        aria-hidden="true"
      />
    </main>
  );
}

export default App;
