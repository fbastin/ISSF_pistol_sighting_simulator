#!/usr/bin/env python3
"""
Convert doc.tex into a single-page navigable HTML documentation site.

Reads the LaTeX source, splits it into sections, converts markup to
Markdown (rendered client-side by marked.js + MathJax), and emits
docs/index.html with a sidebar, prev/next navigation, and responsive
mobile layout.

Usage:
    python3 tex2html.py                  # reads doc.tex, writes docs/index.html
    python3 tex2html.py input.tex        # custom input
    python3 tex2html.py input.tex out/   # custom input and output directory
"""

import re
import sys
import os
import subprocess
import tempfile
import textwrap


# ── LaTeX to Markdown conversion ─────────────────────────────────────

def strip_preamble(tex: str) -> str:
    """Return everything after \\begin{document} and before \\end{document}."""
    m = re.search(r'\\begin\{document\}', tex)
    if m:
        tex = tex[m.end():]
    m = re.search(r'\\end\{document\}', tex)
    if m:
        tex = tex[:m.start()]
    # Strip \maketitle, \tableofcontents, \clearpage
    tex = re.sub(r'\\maketitle\b', '', tex)
    tex = re.sub(r'\\tableofcontents\b', '', tex)
    tex = re.sub(r'\\clearpage\b', '', tex)
    return tex


STANDALONE_TEMPLATE = r"""\documentclass[tikz,border=5pt]{standalone}
\usepackage{amsmath,amssymb}
\usepackage{xcolor}
\usetikzlibrary{calc, angles, quotes, patterns, arrows.meta, decorations.markings, positioning}
\begin{document}
%s
\end{document}
"""


def extract_tikz_figures(tex: str) -> list[dict | None]:
    """Extract all figure environments containing TikZ from the document body."""
    body = strip_preamble(tex)
    figures = []
    for m in re.finditer(
        r'\\begin\{figure\}\[H\](.*?)\\end\{figure\}',
        body, re.DOTALL
    ):
        fig_body = m.group(1)
        tikz_match = re.search(
            r'(\\begin\{tikzpicture\}.*?\\end\{tikzpicture\})',
            fig_body, re.DOTALL
        )
        if not tikz_match:
            figures.append(None)
            continue
        label_match = re.search(r'\\label\{(fig:\w+)\}', fig_body)
        label = label_match.group(1) if label_match else f'fig:{len(figures)}'
        figures.append({
            'tikz': tikz_match.group(1),
            'label': label,
        })
    return figures


def compile_figures(figures: list[dict | None], out_dir: str) -> list[str | None]:
    """Compile TikZ figures to SVG files. Returns list of relative SVG paths."""
    fig_dir = os.path.join(out_dir, 'figures')
    os.makedirs(fig_dir, exist_ok=True)

    svg_paths = []
    for i, fig in enumerate(figures):
        if fig is None:
            svg_paths.append(None)
            continue

        svg_name = f'fig_{i}.svg'
        svg_path = os.path.join(fig_dir, svg_name)
        tex_content = STANDALONE_TEMPLATE % fig['tikz']

        with tempfile.TemporaryDirectory() as tmpdir:
            tex_file = os.path.join(tmpdir, 'figure.tex')
            with open(tex_file, 'w') as f:
                f.write(tex_content)

            result = subprocess.run(
                ['pdflatex', '-interaction=nonstopmode', 'figure.tex'],
                cwd=tmpdir, capture_output=True, text=True
            )
            pdf_file = os.path.join(tmpdir, 'figure.pdf')
            if not os.path.exists(pdf_file):
                print(f"  WARNING: pdflatex failed for figure {i} ({fig['label']})")
                svg_paths.append(None)
                continue

            subprocess.run(
                ['dvisvgm', '--pdf', '--no-fonts', 'figure.pdf', '-o', svg_path],
                cwd=tmpdir, capture_output=True, text=True
            )
            if os.path.exists(svg_path):
                print(f"  {svg_name} <- {fig['label']}")
                svg_paths.append(f'figures/{svg_name}')
            else:
                print(f"  WARNING: dvisvgm failed for figure {i}")
                svg_paths.append(None)

    return svg_paths


def split_sections(body: str) -> list[tuple[str, str]]:
    """Split on \\section{Title} and return [(title, content), ...]."""
    pattern = r'\\section\{([^}]+)\}'
    parts = re.split(pattern, body)
    pre = parts[0].strip()
    sections = []
    for i in range(1, len(parts), 2):
        title = parts[i].strip()
        content = parts[i + 1] if i + 1 < len(parts) else ""
        sections.append((title, content))
    # Prepend any meaningful content before the first \section to the first section
    if pre and len(pre) > 50 and sections:
        first_title, first_content = sections[0]
        sections[0] = (first_title, pre + '\n\n' + first_content)
    elif pre and len(pre) > 50:
        sections.insert(0, ("Introduction", pre))
    return sections


def convert_section(tex: str, fig_svgs: list[str | None] = None,
                    fig_counter: list[int] = None) -> str:
    """Convert a single section's LaTeX body to Markdown."""
    md = tex
    if fig_svgs is None:
        fig_svgs = []
    if fig_counter is None:
        fig_counter = [0]

    # Remove \label{...}
    md = re.sub(r'\\label\{[^}]*\}', '', md)

    # Remove \noindent
    md = re.sub(r'\\noindent\b\s*', '', md)

    # ── Figures: include SVG image + caption ─────────────────────────
    def replace_figure(m):
        body = m.group(1)
        idx = fig_counter[0]
        fig_counter[0] += 1

        cap = re.search(r'\\caption\{(.+?)\}', body, re.DOTALL)
        caption = ''
        if cap:
            caption = convert_inline(cap.group(1).strip())

        svg = fig_svgs[idx] if idx < len(fig_svgs) else None
        if svg:
            parts = ['\n<div style="text-align:center;margin:1.5rem 0">']
            parts.append(f'<img src="{svg}" alt="{caption}" style="max-width:100%">')
            if caption:
                parts.append(f'<br><em><strong>Figure.</strong> {caption}</em>')
            parts.append('</div>\n\n')
            return ''.join(parts)

        if caption:
            return f'\n> **Figure.** {caption}\n\n'
        return '\n'

    md = re.sub(
        r'\\begin\{figure\}\[H\](.*?)\\end\{figure\}',
        replace_figure, md, flags=re.DOTALL
    )

    # ── Tables ───────────────────────────────────────────────────────
    md = convert_tables(md)

    # ── Code listings ────────────────────────────────────────────────
    md = re.sub(
        r'\\begin\{lstlisting\}(.*?)\\end\{lstlisting\}',
        lambda m: '\n```javascript\n' + m.group(1).strip() + '\n```\n',
        md, flags=re.DOTALL
    )

    # ── Math environments ────────────────────────────────────────────
    # equation -> $$ ... $$
    md = re.sub(
        r'\\begin\{equation\}(.*?)\\end\{equation\}',
        lambda m: '\n$$\n' + clean_math(m.group(1)) + '\n$$\n',
        md, flags=re.DOTALL
    )
    # align / align* -> $$ \begin{aligned} ... \end{aligned} $$
    md = re.sub(
        r'\\begin\{align\*?\}(.*?)\\end\{align\*?\}',
        lambda m: '\n$$\n\\begin{aligned}' + clean_math(m.group(1)) + '\\end{aligned}\n$$\n',
        md, flags=re.DOTALL
    )
    # display math \[ ... \]
    md = re.sub(
        r'\\\[(.*?)\\\]',
        lambda m: '\n$$\n' + clean_math(m.group(1)) + '\n$$\n',
        md, flags=re.DOTALL
    )

    # ── Lists ────────────────────────────────────────────────────────
    md = convert_lists(md)

    # ── Subsections / subsubsections ─────────────────────────────────
    md = re.sub(r'\\subsection\*?\{([^}]+)\}', r'\n## \1\n', md)
    md = re.sub(r'\\subsubsection\*?\{([^}]+)\}', r'\n### \1\n', md)

    # ── Inline markup ────────────────────────────────────────────────
    md = convert_inline(md)

    # ── Cleanup ──────────────────────────────────────────────────────
    # Remove leftover LaTeX comments (lines starting with %)
    md = re.sub(r'^%.*$', '', md, flags=re.MULTILINE)
    # Remove decoration lines (═══)
    md = re.sub(r'^[%═─\s]*$', '', md, flags=re.MULTILINE)
    # Collapse multiple blank lines
    md = re.sub(r'\n{4,}', '\n\n\n', md)

    return md.strip()


def clean_math(s: str) -> str:
    """Clean up math content: remove labels, preserve content."""
    s = re.sub(r'\\label\{[^}]*\}', '', s)
    return s.strip()


def convert_inline(s: str) -> str:
    """Convert inline LaTeX markup to Markdown."""
    # \textbf{...} -> **...**
    s = re.sub(r'\\textbf\{([^}]*)\}', r'**\1**', s)
    # \emph{...} and \textit{...} -> *...*
    s = re.sub(r'\\emph\{([^}]*)\}', r'*\1*', s)
    s = re.sub(r'\\textit\{([^}]*)\}', r'*\1*', s)
    # \texttt{...} and \code{...} and \file{...} -> `...`
    s = re.sub(r'\\texttt\{([^}]*)\}', r'`\1`', s)
    s = re.sub(r'\\code\{([^}]*)\}', r'`\1`', s)
    s = re.sub(r'\\file\{([^}]*)\}', r'`\1`', s)
    # \key{...} -> **...**
    s = re.sub(r'\\key\{([^}]*)\}', r'**\1**', s)
    # \textcolor{...}{...} -> just the text
    s = re.sub(r'\\textcolor\{[^}]*\}\{([^}]*)\}', r'\1', s)
    # \textsf{...} -> just the text
    s = re.sub(r'\\textsf\{([^}]*)\}', r'\1', s)
    # \cref{...} and \Cref{...} -> *Section Name*
    s = re.sub(r'\\[Cc]ref\{([^}]*)\}', lambda m: cref_replace(m.group(1)), s)
    # \cite{...} -> [keys]
    s = re.sub(r'~?\\cite\{([^}]*)\}', r'[\1]', s)
    # \url{...} -> [url](url)
    s = re.sub(r'\\url\{([^}]*)\}', r'[\1](\1)', s)
    # --- -> —
    s = s.replace('---', '—')
    # -- -> –
    s = s.replace('--', '–')
    # `` and '' -> "
    s = s.replace("``", "“")
    s = s.replace("''", "”")
    # \, -> thin space (or just space in MD)
    s = re.sub(r'\\,', ' ', s)
    # \; and \: and \! -> space or nothing
    s = re.sub(r'\\[;:!]', ' ', s)
    # \@ -> nothing
    s = re.sub(r'\\@', '', s)
    # ~ -> non-breaking space (just regular space in MD)
    s = s.replace('~', ' ')
    # \% -> %
    s = s.replace('\\%', '%')
    # \$ -> $ (but be careful with math)
    # $\times$ -> × (but leave normal $ math alone)
    s = s.replace('$\\times$', '×')
    # $\approx$ -> ≈
    s = s.replace('$\\approx$', '≈')
    # Remove \noindent
    s = re.sub(r'\\noindent\s*', '', s)
    # Remove remaining \centering
    s = re.sub(r'\\centering\s*', '', s)
    # Remove [nosep]
    s = re.sub(r'\[nosep\]', '', s)

    return s


# Map of \label keys to human-readable section names
CREF_MAP = {
    'sec:intro': 'Introduction',
    'sec:manual': 'User Manual',
    'sec:parallax': 'Parallax Error',
    'sec:aperture': 'Aperture Size and Eye Relief',
    'sec:ballistics': 'Exterior Ballistics: Gravity and Trajectory',
    'sec:cant': 'Rifle Cant',
    'sec:clicks': 'Mechanical Sight Adjustment (Clicks)',
    'sec:wind': 'Wind Drift',
    'sec:scoring': 'Scoring Model',
    'sec:implementation': 'Implementation Notes',
    'sec:errata': 'Summary of Corrections Applied',
    'sec:layout': 'User Manual',
    'sec:controls': 'User Manual',
    'sec:quickstart': 'User Manual',
    'sec:parallax-impl': 'Parallax Error',
    'sec:cant-impl': 'Rifle Cant',
    'sec:coords': 'Implementation Notes',
    'fig:layout': 'User Manual',
    'fig:parallax': 'Parallax Error',
    'fig:aperture': 'Aperture Size and Eye Relief',
    'fig:trajectory': 'Exterior Ballistics: Gravity and Trajectory',
    'fig:cant': 'Rifle Cant',
    'fig:clicks': 'Mechanical Sight Adjustment (Clicks)',
    'fig:wind': 'Wind Drift',
    'tab:controls': 'User Manual',
    'tab:drop': 'Exterior Ballistics: Gravity and Trajectory',
    'tab:wind': 'Wind Drift',
    'tab:signs': 'Implementation Notes',
    'tab:constants': 'Implementation Notes',
    'eq:parallax': 'Parallax Error',
    'eq:damping': 'Parallax Error',
    'eq:apparent-size': 'Aperture Size and Eye Relief',
    'eq:rearR': 'Aperture Size and Eye Relief',
    'eq:blur': 'Aperture Size and Eye Relief',
    'eq:tof': 'Exterior Ballistics: Gravity and Trajectory',
    'eq:drop': 'Exterior Ballistics: Gravity and Trajectory',
    'eq:totalcomp': 'Exterior Ballistics: Gravity and Trajectory',
    'eq:cant-x': 'Rifle Cant',
    'eq:cant-y': 'Rifle Cant',
    'eq:clicks': 'Mechanical Sight Adjustment (Clicks)',
    'eq:wind-x': 'Wind Drift',
    'eq:wind-y': 'Wind Drift',
    'eq:score': 'Scoring Model',
}


def cref_replace(keys: str) -> str:
    """Replace \\cref{key1,key2} with readable names."""
    parts = [k.strip() for k in keys.split(',')]
    names = []
    seen = set()
    for p in parts:
        name = CREF_MAP.get(p, p)
        if name not in seen:
            names.append(f'*{name}*')
            seen.add(name)
    return ' and '.join(names) if len(names) <= 2 else ', '.join(names)


def md_inline_to_html(s: str) -> str:
    """Convert markdown bold/italic to HTML for use inside HTML elements."""
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'\*(.+?)\*', r'<em>\1</em>', s)
    s = re.sub(r'`(.+?)`', r'<code>\1</code>', s)
    return s


def convert_tables(md: str) -> str:
    """Convert LaTeX tabular environments to HTML tables."""
    pattern = r'\\begin\{table\}\[H\](.*?)\\end\{table\}'
    md = re.sub(pattern, lambda m: _convert_one_table(m.group(1)), md, flags=re.DOTALL)
    return md


def _convert_one_table(body: str) -> str:
    """Convert a single table environment body to an HTML table."""
    cap_match = re.search(r'\\caption\{(.+?)\}', body, re.DOTALL)
    caption = ''
    if cap_match:
        caption = md_inline_to_html(convert_inline(cap_match.group(1).strip()))

    # Handle nested braces in column spec like {@{}llll@{}}
    tab_match = re.search(
        r'\\begin\{tabular\}\{(?:[^{}]*|\{[^{}]*\})*\}(.*?)\\end\{tabular\}',
        body, re.DOTALL
    )
    if not tab_match:
        return f'\n<p><strong>{caption}</strong></p>\n' if caption else '\n'

    tab = tab_match.group(1)

    tab = re.sub(r'\\(toprule|midrule|bottomrule)\s*', '', tab)
    tab = re.sub(r'\\(small|centering)\s*', '', tab)

    rows = [r.strip() for r in tab.split('\\\\') if r.strip()]
    if not rows:
        return f'\n<p><strong>{caption}</strong></p>\n' if caption else '\n'

    html = '\n<table>\n'
    if caption:
        html += f'<caption><strong>Table.</strong> {caption}</caption>\n'

    for i, row in enumerate(rows):
        cells = [md_inline_to_html(convert_inline(c.strip())) for c in row.split('&')]
        tag = 'th' if i == 0 else 'td'
        html += '<tr>' + ''.join(f'<{tag}>{c}</{tag}>' for c in cells) + '</tr>\n'

    html += '</table>\n'
    return html


def convert_lists(md: str) -> str:
    """Convert LaTeX enumerate/itemize to Markdown lists."""
    def replace_list(m):
        env = m.group(1)  # enumerate or itemize
        body = m.group(2)
        items = re.split(r'\\item\s*', body)
        items = [i.strip() for i in items if i.strip()]

        result = '\n'
        for idx, item in enumerate(items):
            item = item.rstrip().rstrip('\\')
            if env == 'enumerate':
                result += f'{idx + 1}. {item}\n'
            else:
                result += f'- {item}\n'
        result += '\n'
        return result

    # Handle nested or sequential lists
    md = re.sub(
        r'\\begin\{(enumerate|itemize)\}(?:\[[^\]]*\])?\s*(.*?)\\end\{\1\}',
        replace_list, md, flags=re.DOTALL
    )
    return md


def convert_bibliography(tex: str) -> list[tuple[str, str]] | None:
    """Extract bibliography entries and return as a section if present."""
    bib_match = re.search(
        r'\\begin\{thebibliography\}\{[^}]*\}(.*?)\\end\{thebibliography\}',
        tex, re.DOTALL
    )
    if not bib_match:
        return None

    body = bib_match.group(1)
    entries = re.findall(r'\\bibitem\{(\w+)\}\s*(.*?)(?=\\bibitem|\Z)', body, re.DOTALL)

    lines = ['# References\n']
    for key, content in entries:
        content = content.strip()
        content = convert_inline(content)
        content = re.sub(r'\s+', ' ', content)
        lines.append(f'- **[{key}]** {content}')

    return '\n'.join(lines)


# ── HTML template ────────────────────────────────────────────────────

HTML_TEMPLATE = '''\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ISSF Rifle Sighting Simulator — Documentation</title>

<script>
MathJax = {{
  tex: {{
    inlineMath: [['$', '$']],
    displayMath: [['$$', '$$']],
    processEscapes: true
  }},
  options: {{ skipHtmlTags: ['script','noscript','style','textarea','pre','code'] }}
}};
</script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js" async></script>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>

<style>
:root {{
  --sidebar-w: 280px;
  --bg: #fafafa;
  --fg: #222;
  --accent: #2563eb;
  --sidebar-bg: #1e293b;
  --sidebar-fg: #cbd5e1;
  --sidebar-active: #60a5fa;
  --border: #e2e8f0;
  --code-bg: #f1f5f9;
}}
*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
html {{ scroll-behavior: smooth; }}
body {{
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.7;
}}

/* ── Sidebar ───────────────────────────────────────────────── */
#sidebar {{
  position: fixed; top: 0; left: 0;
  width: var(--sidebar-w); height: 100vh;
  background: var(--sidebar-bg);
  color: var(--sidebar-fg);
  overflow-y: auto;
  padding: 1.5rem 0;
  z-index: 10;
  transition: transform .25s;
}}
#sidebar h2 {{
  font-size: .85rem; text-transform: uppercase; letter-spacing: .08em;
  padding: 0 1.2rem .8rem; color: #94a3b8; border-bottom: 1px solid #334155;
  margin-bottom: .6rem;
}}
#sidebar ul {{ list-style: none; }}
#sidebar li a {{
  display: block; padding: .45rem 1.2rem;
  color: var(--sidebar-fg); text-decoration: none;
  font-size: .92rem; border-left: 3px solid transparent;
  transition: background .15s, border-color .15s;
  cursor: pointer;
}}
#sidebar li a:hover {{ background: #334155; }}
#sidebar li a.active {{
  color: var(--sidebar-active); border-left-color: var(--sidebar-active);
  background: rgba(96,165,250,.08);
}}

/* ── Hamburger (mobile) ────────────────────────────────────── */
#menu-btn {{
  display: none; position: fixed; top: .8rem; left: .8rem;
  z-index: 20; background: var(--sidebar-bg); color: #fff;
  border: none; border-radius: 6px; padding: .4rem .6rem;
  font-size: 1.3rem; cursor: pointer;
}}

/* ── Main ──────────────────────────────────────────────────── */
#main {{
  margin-left: var(--sidebar-w);
  max-width: 52rem;
  padding: 2.5rem 2.5rem 6rem;
}}
#main h1 {{ font-size: 1.8rem; margin-bottom: .3rem; }}
#main h2 {{ font-size: 1.35rem; margin-top: 2rem; margin-bottom: .5rem; border-bottom: 1px solid var(--border); padding-bottom: .3rem; }}
#main h3 {{ font-size: 1.1rem; margin-top: 1.5rem; margin-bottom: .4rem; }}
#main p {{ margin: .7rem 0; }}
#main ol, #main ul {{ margin: .5rem 0 .5rem 1.6rem; }}
#main li {{ margin: .25rem 0; }}
#main blockquote {{
  border-left: 4px solid var(--accent); background: #eff6ff;
  padding: .7rem 1rem; margin: 1rem 0; border-radius: 0 6px 6px 0;
}}
#main table {{
  border-collapse: collapse; margin: 1rem 0; width: 100%;
  font-size: .93rem;
}}
#main th, #main td {{
  border: 1px solid var(--border); padding: .4rem .7rem; text-align: left;
}}
#main th {{ background: #f1f5f9; font-weight: 600; }}
#main caption {{
  caption-side: top; text-align: left;
  font-size: .93rem; margin-bottom: .4rem; color: #374151;
}}
#main pre {{
  background: var(--code-bg); border: 1px solid var(--border);
  border-radius: 6px; padding: 1rem; overflow-x: auto;
  font-size: .88rem; line-height: 1.5; margin: 1rem 0;
}}
#main code {{
  font-family: 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: .9em;
}}
#main :not(pre) > code {{
  background: var(--code-bg); padding: .15em .35em; border-radius: 4px;
}}
.MathJax {{ font-size: 1.05em !important; }}

/* ── Nav buttons ───────────────────────────────────────────── */
#nav-bar {{
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 3rem; padding-top: 1.2rem;
  border-top: 1px solid var(--border);
}}
#nav-bar button {{
  background: var(--accent); color: #fff; border: none;
  padding: .55rem 1.4rem; border-radius: 6px;
  font-size: .95rem; cursor: pointer; transition: opacity .15s;
}}
#nav-bar button:hover {{ opacity: .85; }}
#nav-bar button:disabled {{ opacity: .35; cursor: default; }}
#nav-bar .page-info {{ font-size: .85rem; color: #64748b; }}

/* ── Responsive ────────────────────────────────────────────── */
@media (max-width: 860px) {{
  #sidebar {{ transform: translateX(-100%); }}
  #sidebar.open {{ transform: translateX(0); }}
  #menu-btn {{ display: block; }}
  #main {{ margin-left: 0; padding: 2rem 1.2rem 5rem; }}
}}
</style>
</head>
<body>

<button id="menu-btn" onclick="document.getElementById('sidebar').classList.toggle('open')">&#9776;</button>

<nav id="sidebar">
  <h2>Documentation</h2>
  <ul id="toc"></ul>
</nav>

<main id="main">
  <div id="content"></div>
  <div id="nav-bar">
    <button id="btn-prev" onclick="go(-1)">&larr; Previous</button>
    <span class="page-info" id="page-info"></span>
    <button id="btn-next" onclick="go(1)">Next &rarr;</button>
  </div>
</main>

{pages}

<script>
const pageEls = document.querySelectorAll('script[type="text/markdown"]');
const pages = Array.from(pageEls).map(el => ({{
  title: el.dataset.title,
  md: el.textContent
}}));

let cur = 0;

function render(i) {{
  cur = i;
  const html = marked.parse(pages[i].md);
  document.getElementById('content').innerHTML = '<h1>' + pages[i].title + '</h1>\\n' + html;

  if (window.MathJax && MathJax.typeset) {{
    MathJax.typesetClear();
    MathJax.typeset();
  }}

  document.querySelectorAll('#toc a').forEach((a, j) => {{
    a.classList.toggle('active', j === i);
  }});

  document.getElementById('btn-prev').disabled = (i === 0);
  document.getElementById('btn-next').disabled = (i === pages.length - 1);
  document.getElementById('page-info').textContent = (i+1) + ' / ' + pages.length;

  window.scrollTo(0, 0);
  location.hash = '#' + i;

  // close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
}}

function go(delta) {{
  const next = cur + delta;
  if (next >= 0 && next < pages.length) render(next);
}}

// build TOC
const toc = document.getElementById('toc');
pages.forEach((p, i) => {{
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.textContent = p.title;
  a.onclick = () => render(i);
  li.appendChild(a);
  toc.appendChild(li);
}});

// keyboard nav
document.addEventListener('keydown', e => {{
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowLeft' && e.altKey) go(-1);
  if (e.key === 'ArrowRight' && e.altKey) go(1);
}});

// initial page from hash
const initPage = parseInt(location.hash.slice(1)) || 0;
render(Math.min(initPage, pages.length - 1));
</script>
</body>
</html>
'''


def build_page_script(index: int, title: str, md_content: str) -> str:
    """Wrap Markdown content in a <script type="text/markdown"> tag."""
    # Escape </script> inside content (shouldn't occur, but safety)
    safe = md_content.replace('</script>', '<\\/script>')
    return f'<script type="text/markdown" data-title="{title}" id="page-{index}">\n{safe}\n</script>'


def main():
    # Parse arguments
    tex_path = 'doc.tex'
    out_dir = 'docs'

    if len(sys.argv) >= 2:
        tex_path = sys.argv[1]
    if len(sys.argv) >= 3:
        out_dir = sys.argv[2]

    # Resolve paths relative to script location
    script_dir = os.path.dirname(os.path.abspath(__file__))
    if not os.path.isabs(tex_path):
        tex_path = os.path.join(script_dir, tex_path)
    if not os.path.isabs(out_dir):
        out_dir = os.path.join(script_dir, out_dir)

    print(f"Reading {tex_path}")
    with open(tex_path, 'r', encoding='utf-8') as f:
        tex = f.read()

    # Extract and compile TikZ figures to SVG
    print("Compiling TikZ figures to SVG...")
    figures = extract_tikz_figures(tex)
    fig_svgs = compile_figures(figures, out_dir)
    print(f"  {sum(1 for s in fig_svgs if s):d}/{len(figures)} figures compiled")

    # Extract body
    body = strip_preamble(tex)

    # Split into sections
    sections = split_sections(body)

    # Check for bibliography (it's after the last section in the original body)
    bib_md = convert_bibliography(tex)

    # Convert each section (shared counter tracks figure order across sections)
    fig_counter = [0]
    pages = []
    for title, content in sections:
        md = convert_section(content, fig_svgs, fig_counter)
        pages.append((title, md))

    # Add bibliography as final page if present
    if bib_md:
        pages.append(("References", bib_md))

    print(f"Found {len(pages)} pages:")
    for i, (title, _) in enumerate(pages):
        print(f"  {i:2d}. {title}")

    # Build page script tags
    page_scripts = []
    for i, (title, md) in enumerate(pages):
        page_scripts.append(build_page_script(i, title, md))

    pages_html = '\n'.join(page_scripts)
    html = HTML_TEMPLATE.format(pages=pages_html)

    # Write output
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, 'index.html')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(html)

    print(f"Wrote {out_path} ({len(html):,} bytes)")


if __name__ == '__main__':
    main()
