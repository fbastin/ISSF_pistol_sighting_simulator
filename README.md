# ISSF Pistol Sighting Simulator

A browser-based pedagogical tool that models the optics and physics of ISSF
**open-sight (notch-and-post) pistol** marksmanship, shot **one-handed and
unsupported** (free arm). It lets shooters and coaches isolate and observe the
effects that are hard to separate on the range:

- **Sight-alignment (angular) error** — how a tiny displacement of the front
  post within the rear notch turns into a large miss downrange (a 0.1 mm error
  at the sights is already > 4.5 mm at 10 m).
- **Arm sway / wobble** — the natural movement of an unsupported pistol and why
  a parallel wobble hurts far less than a constant alignment error.
- **Visual accommodation (focus)** — the eye can focus on only one plane;
  the tool shows why the **front sight must stay sharp** while the target blurs.
- **Hold / aiming zone** — 6-o'clock (sub-six) hold versus point-of-aim =
  point-of-impact.
- **Mechanical sight clicks** — windage/elevation adjustments translated to the
  target face.
- **Wind drift** and **firearm cant**.

It is a companion to the [ISSF Rifle Sighting Simulator](https://github.com/fbastin/ISSF_rifle_sighting_simulator),
which covers the aperture (dioptre) sighting system used in precision rifle.

## Files and structure

- **`index.html`** — standalone entry point. Open it in any modern browser to
  run the simulator (canvas + control panels). No build step, no dependencies.
- **`simulator.js`** — the core logic: optics/ballistics model, rendering of the
  sight picture and target face, scoring, and the shot-session statistics.
- **`doc.tex` / `doc.pdf`** — the mathematical/physics reference and user guide
  (LaTeX source and compiled PDF).
- **`docs/`** — the same documentation as a single-page navigable HTML site
  (`docs/index.html`, with SVG figures under `docs/figures/`).
- **`tex2html.py`** — utility that compiles the TikZ figures and converts
  `doc.tex` into `docs/index.html`.
- **`LICENSE`** — MIT.

## Building the documentation

```bash
pdflatex doc.tex && pdflatex doc.tex   # -> doc.pdf
python3 tex2html.py                     # -> docs/index.html (+ docs/figures/)
```

Requires a LaTeX distribution (with `pdflatex` and `dvisvgm`) and Python 3.

## Running the simulator

No special software is required — just a modern web browser (Chrome, Firefox,
Safari, Edge). Open `index.html`.

On [tireur.org](https://www.tireur.org/techniques/visee/pistol_sighting.php)
the simulator is embedded through a PHP wrapper that supplies the same control
panel and loads `simulator.js`; this repository is consumed there as a git
submodule.

## Controls

The simulator is driven by the on-screen panels (target/hold/focus, wobble &
wind, sight alignment, mechanical clicks). When the canvas has focus, a few
keyboard shortcuts are also available:

| Key | Action |
| :--- | :--- |
| **A** / **D** | Horizontal sight-alignment error ∓ / ± 0.02 mm (0.05 with Shift) |
| **W** / **S** | Vertical sight-alignment error ∓ / ± 0.02 mm |
| **Z** / **X** | Firearm cant ∓ / ± 0.5° |
| **Space** | Fire a shot |
| **R** | Reset the sights |
| Mouse over canvas | Give the canvas focus (enables shortcuts) |

## License

MIT — see [`LICENSE`](LICENSE).
