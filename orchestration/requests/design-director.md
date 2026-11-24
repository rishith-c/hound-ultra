# Requests from design-director

All optional. The shell looks finished without them; the CSS for each is already in `app/shell.css`, so each
one lights up as soon as the markup is there.

## 1. `app/shell.js`: a phase track in the mission status (CSS ready: `.tb-track`)

Why: the top bar says which phase the mission is in, but not how far through the mission that is.

In `buildChrome()`, replace the `tb-mission` line with:

```js
h('div.tb-mission', null, h('b', { id: 'tb-phase' }, 'Loading'),
  h('div.tb-track', { id: 'tb-track', role: 'img', 'aria-label': 'Mission progress' },
    ...Object.keys(PHASE_INFO).map((p) => h('i', { 'data-phase': p, title: PHASE_INFO[p].label }))),
  h('span.dim', { id: 'tb-hint' }, '')),
```

In `refreshChrome()`, after `$('tb-hint').textContent = …`:

```js
const phases = Object.keys(PHASE_INFO), now = phases.indexOf(S.phase);
[...$('tb-track').children].forEach((el, i) => { el.classList.toggle('done', i < now); el.classList.toggle('now', i === now); });
$('tb-track').setAttribute('aria-label', `Mission progress: step ${now + 1} of ${phases.length}, ${info.label}`);
```

## 2. `app/shell.js`: tell the stylesheet about all stop (CSS ready: `:root[data-hold="true"]`)

Why: during an all stop the phase title and the current tick turn red, so the held state is visible in the bar.

In `refreshChrome()`, add one line:

```js
document.documentElement.dataset.hold = String(!!S.hold);
```

## 3. `app/index.html`: preload the two fonts every screen uses

Why: removes the brief flash of the fallback font on first load. Add inside `<head>`, before the stylesheets:

```html
<link rel="preload" as="font" type="font/woff2" crossorigin href="../assets/brand/fonts/instrument-sans-latin-wdth-normal.woff2">
<link rel="preload" as="font" type="font/woff2" crossorigin href="../assets/brand/fonts/instrument-serif-latin-400-normal.woff2">
```

## 4. `app/shell.js`: link the reference page (one line)

In the status bar, next to "What is real?":

```js
h('a', { href: 'ui/reference.html', target: '_blank', rel: 'noopener' }, 'Design reference'),
```

## 5. Landing page (`index.html` at the site root, landing agent)

Brand files are in `assets/brand/`: `hound-lockup.svg`, `hound-mark.svg`, `hound-wordmark.svg` (ivory, for dark
backgrounds) and `-ink` versions for light ones. Below 28 px use `hound-mark-small.svg`. The favicon
`assets/img/icon.svg` is already the new mark. Link `app/ui/tokens.css` to get the fonts and tokens.
