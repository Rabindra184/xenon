/**
 * How the API reference at /xenon/api-docs looks: the dashboard's colours
 * (web/src/tokens.css), dark or light as the dashboard is set.
 *
 * Swagger UI ships a light page full of its own greys (#3b4151 text, white
 * section bars), so every surface it paints is set here, through the
 * variables below. The values are the dashboard's: graphite dark by default,
 * its light palette under [data-theme='light']. Method labels are tinted, as
 * the dashboard's status pills are. Text clears 4.5:1 on every surface in
 * both themes.
 *
 * Code blocks stay dark in both themes: Swagger UI's syntax colours are
 * written for a dark background.
 */

/**
 * Sets <html data-theme> from the theme chosen in the dashboard's account
 * menu (localStorage 'xenon.theme': dark, light or system), as
 * web/index.html does, and follows the OS live while it is "system". Nothing
 * saved, or storage blocked: dark, the dashboard's default. It runs as the
 * page is parsed; Swagger UI draws on window.onload, after it.
 *
 * It also keeps Swagger UI's own `dark-mode` class off <html>. The top bar
 * (hidden here) adds it when the OS is dark, and it turns on some 240 rules of
 * Swagger UI's own dark palette, which then fight these colours on dark Macs
 * only.
 */
export const API_DOCS_THEME_SCRIPT = `
(function () {
  var media = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)')
    : null;
  function apply() {
    var pref = 'dark';
    try { pref = localStorage.getItem('xenon.theme') || 'dark'; } catch (e) {}
    var light = pref === 'light' || (pref === 'system' && !!media && media.matches);
    document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
  }
  apply();
  var root = document.documentElement;
  function noSwaggerDarkMode() {
    if (root.classList && root.classList.contains('dark-mode')) root.classList.remove('dark-mode');
  }
  noSwaggerDarkMode();
  if (typeof MutationObserver === 'function') {
    new MutationObserver(noSwaggerDarkMode).observe(root, { attributes: true, attributeFilter: ['class'] });
  }
  if (media && media.addEventListener) media.addEventListener('change', apply);
  window.addEventListener('storage', function (e) { if (e.key === 'xenon.theme') apply(); });
})();
`;

export const API_DOCS_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');

:root {
  color-scheme: dark;
  --xd-bg: #0e1013;
  --xd-surface: #15181d;
  --xd-surface-2: #1b1f25;
  --xd-sunken: #0b0d10;
  --xd-border: #262b33;
  --xd-border-strong: #333a44;
  --xd-text: #e7e9ee;
  --xd-muted: #a3a9b5;
  --xd-dim: #868d99;
  --xd-accent: #60a5fa;
  --xd-on-accent: #0e1013;
  --xd-code: #4ade80;
  --xd-danger: #f87171;
  --xd-get: #60a5fa;
  --xd-post: #4ade80;
  --xd-put: #fbbf24;
  --xd-patch: #2dd4bf;
  --xd-delete: #f87171;
  --xd-other: #c4b5fd;
  --xd-code-bg: #0b0d10;
  --xd-icon-filter: invert(0.85);
  --xd-backdrop: rgba(0, 0, 0, 0.6);
}

:root[data-theme='light'] {
  color-scheme: light;
  --xd-bg: #f6f7f9;
  --xd-surface: #ffffff;
  --xd-surface-2: #f1f3f6;
  --xd-sunken: #eceff3;
  --xd-border: #e3e6eb;
  --xd-border-strong: #d3d8df;
  --xd-text: #14171c;
  --xd-muted: #4b5260;
  --xd-dim: #5f6673;
  --xd-accent: #1d4ed8;
  --xd-on-accent: #ffffff;
  --xd-code: #146c35;
  --xd-danger: #c62828;
  --xd-get: #1d4ed8;
  --xd-post: #146c35;
  --xd-put: #b45309;
  --xd-patch: #0f766e;
  --xd-delete: #c62828;
  --xd-other: #6d28d9;
  --xd-code-bg: #1b1f25;
  --xd-icon-filter: none;
  --xd-backdrop: rgba(20, 23, 28, 0.4);
}

html, body { background: var(--xd-bg) !important; }
body { margin: 0; font-family: 'Inter', system-ui, -apple-system, sans-serif !important; -webkit-font-smoothing: antialiased; }
.swagger-ui { background: var(--xd-bg); color: var(--xd-text); padding-bottom: 80px; font-family: inherit; }
.swagger-ui, .swagger-ui .info, .swagger-ui .opblock-tag, .swagger-ui .btn, .swagger-ui select, .swagger-ui input, .swagger-ui textarea { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
.swagger-ui code, .swagger-ui pre, .swagger-ui .opblock-summary-path, .swagger-ui .opblock-summary-method, .swagger-ui .parameter__type, .swagger-ui .prop-type, .swagger-ui .model-title, .swagger-ui .response-col_status {
  font-family: 'JetBrains Mono', ui-monospace, Menlo, Monaco, Consolas, monospace !important;
}

/* Layout */
.swagger-ui .wrapper { max-width: 1100px; padding: 0 40px; }
.swagger-ui .topbar { display: none; }

/* Title and introduction */
.swagger-ui .info { margin: 56px 0 32px; }
.swagger-ui .info .title { color: var(--xd-text) !important; font-size: 40px; font-weight: 700; letter-spacing: -0.02em; }
.swagger-ui .info .title small { background: var(--xd-surface-2) !important; border: 1px solid var(--xd-border-strong); border-radius: 4px; padding: 2px 6px; top: -10px; }
.swagger-ui .info .title small pre { color: var(--xd-muted) !important; font-size: 12px; }
.swagger-ui .info .title small.version-stamp { background: rgb(74 222 128 / 0.1) !important; border-color: rgb(74 222 128 / 0.3); }
:root[data-theme='light'] .swagger-ui .info .title small.version-stamp { background: rgb(20 108 53 / 0.08) !important; border-color: rgb(20 108 53 / 0.25); }
.swagger-ui .info .title small.version-stamp pre { color: var(--xd-post) !important; }
.swagger-ui .info .base-url, .swagger-ui .info .link span, .swagger-ui .info a.link { color: var(--xd-dim) !important; }
.swagger-ui .info h1, .swagger-ui .info h2, .swagger-ui .info h3, .swagger-ui .info h4, .swagger-ui .info h5,
.swagger-ui .markdown h1, .swagger-ui .markdown h2, .swagger-ui .markdown h3, .swagger-ui .markdown h4,
.swagger-ui .renderedMarkdown h1, .swagger-ui .renderedMarkdown h2, .swagger-ui .renderedMarkdown h3 { color: var(--xd-text) !important; font-family: inherit; }
.swagger-ui .info .markdown h2 { margin-top: 40px; padding-bottom: 8px; border-bottom: 1px solid var(--xd-border); }
.swagger-ui .info p, .swagger-ui .info li, .swagger-ui .info table, .swagger-ui .markdown p, .swagger-ui .markdown li,
.swagger-ui .renderedMarkdown p, .swagger-ui .renderedMarkdown li { color: var(--xd-muted) !important; font-size: 15px; line-height: 1.7; }
.swagger-ui .markdown strong, .swagger-ui .renderedMarkdown strong, .swagger-ui .info strong { color: var(--xd-text) !important; }
.swagger-ui .markdown a, .swagger-ui .renderedMarkdown a, .swagger-ui .info a { color: var(--xd-accent) !important; }
.swagger-ui .markdown code, .swagger-ui .renderedMarkdown code, .swagger-ui .info code {
  background: var(--xd-surface-2) !important; color: var(--xd-code) !important; border: 1px solid var(--xd-border);
  border-radius: 4px; padding: 1px 5px; font-size: 0.9em;
}
.swagger-ui .markdown table, .swagger-ui .renderedMarkdown table { border-collapse: collapse; }
.swagger-ui .markdown table td, .swagger-ui .markdown table th, .swagger-ui .renderedMarkdown table td, .swagger-ui .renderedMarkdown table th {
  color: var(--xd-muted) !important; border: 1px solid var(--xd-border) !important; padding: 8px 12px; vertical-align: top;
}
.swagger-ui .markdown table th, .swagger-ui .renderedMarkdown table th { color: var(--xd-text) !important; background: var(--xd-surface-2); }

/* Servers and Authorize */
.swagger-ui .scheme-container { background: transparent !important; box-shadow: none !important; padding: 0; margin: 32px 0; }
.swagger-ui .scheme-container .wrapper {
  width: calc(100% - 80px); max-width: 1020px; margin: 0 auto; padding: 20px 24px; box-sizing: border-box;
  background: var(--xd-surface); border: 1px solid var(--xd-border); border-radius: 8px;
}
.swagger-ui .scheme-container .schemes > label, .swagger-ui .servers-title, .swagger-ui .servers > label { color: var(--xd-muted) !important; }
.swagger-ui .servers-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }

/* Form controls */
.swagger-ui select, .swagger-ui input[type=text], .swagger-ui input[type=password], .swagger-ui input[type=search], .swagger-ui input[type=email], .swagger-ui input[type=file], .swagger-ui textarea {
  background-color: var(--xd-sunken) !important; color: var(--xd-text) !important; border: 1px solid var(--xd-border-strong) !important;
  border-radius: 6px !important; box-shadow: none !important;
}
.swagger-ui select { padding: 8px 32px 8px 10px; }
.swagger-ui textarea { font-family: 'JetBrains Mono', ui-monospace, monospace; }
.swagger-ui input::placeholder, .swagger-ui textarea::placeholder { color: var(--xd-dim); }
.swagger-ui select:focus, .swagger-ui input:focus, .swagger-ui textarea:focus { outline: 2px solid var(--xd-accent); outline-offset: 1px; }
.swagger-ui input.invalid, .swagger-ui textarea.invalid, .swagger-ui select.invalid { border-color: var(--xd-danger) !important; }

/* Buttons */
.swagger-ui .btn { background: transparent; color: var(--xd-text); border: 1px solid var(--xd-border-strong); border-radius: 6px; box-shadow: none !important; font-weight: 600; }
.swagger-ui .btn:hover { background: var(--xd-surface-2); box-shadow: none; }
.swagger-ui .btn.authorize { color: var(--xd-post); border-color: var(--xd-post); }
.swagger-ui .btn.authorize svg { fill: var(--xd-post); }
.swagger-ui .btn.execute { background: var(--xd-accent) !important; color: var(--xd-on-accent) !important; border-color: var(--xd-accent) !important; }
.swagger-ui .btn.execute:hover { filter: brightness(1.08); }
.swagger-ui .btn.cancel, .swagger-ui .btn.try-out__btn.cancel { color: var(--xd-danger); border-color: var(--xd-danger); }
.swagger-ui .btn-group .btn { border-radius: 6px; }
.swagger-ui .authorization__btn svg, .swagger-ui .authorization__btn .locked, .swagger-ui .authorization__btn .unlocked { fill: var(--xd-dim); }
.swagger-ui .copy-to-clipboard { background: var(--xd-surface-2); border-radius: 4px; }
.swagger-ui .copy-to-clipboard button, .swagger-ui .download-contents { filter: var(--xd-icon-filter); }

/* Sections (tags) */
.swagger-ui .opblock-tag { color: var(--xd-text) !important; border-bottom: 1px solid var(--xd-border) !important; font-size: 22px; font-weight: 600; margin: 40px 0 16px; }
.swagger-ui .opblock-tag:hover { background: transparent; }
.swagger-ui .opblock-tag small, .swagger-ui .opblock-tag small p { color: var(--xd-muted) !important; font-size: 14px; font-weight: 400; }
.swagger-ui .opblock-tag svg, .swagger-ui .expand-operation svg, .swagger-ui .opblock-control-arrow svg, .swagger-ui .opblock-summary-control svg, .swagger-ui svg.arrow { fill: var(--xd-dim) !important; }
.swagger-ui .opblock-tag-section .opblock-tag a, .swagger-ui .opblock-tag a.nostyle span { color: var(--xd-text) !important; }

/* Operations */
.swagger-ui .opblock {
  background: var(--xd-surface) !important; border: 1px solid var(--xd-border) !important; border-radius: 8px !important;
  box-shadow: none !important; margin-bottom: 8px !important; overflow: hidden;
}
.swagger-ui .opblock:hover { border-color: var(--xd-border-strong) !important; }
.swagger-ui .opblock-summary { padding: 8px 12px; border-bottom: none !important; }
.swagger-ui .opblock.is-open .opblock-summary { border-bottom: 1px solid var(--xd-border) !important; }
.swagger-ui .opblock-summary-method {
  min-width: 72px !important; padding: 4px 0 !important; border-radius: 4px !important; font-size: 12px !important; font-weight: 700 !important;
  text-shadow: none !important; border: 1px solid transparent;
}
.swagger-ui .opblock-summary-path, .swagger-ui .opblock-summary-path a, .swagger-ui .opblock-summary-path span { color: var(--xd-text) !important; font-size: 14px !important; font-weight: 500 !important; }
.swagger-ui .opblock-summary-path__deprecated { color: var(--xd-dim) !important; }
.swagger-ui .opblock-summary-description, .swagger-ui .opblock-summary-operation-id { color: var(--xd-muted) !important; font-size: 13px; }
.swagger-ui .opblock.opblock-deprecated { opacity: 0.75; }

/* Method colours: a tinted label, and the open operation's left edge */
.swagger-ui .opblock.opblock-get .opblock-summary-method { background: rgb(96 165 250 / 0.12) !important; color: var(--xd-get) !important; border-color: rgb(96 165 250 / 0.35); }
.swagger-ui .opblock.opblock-post .opblock-summary-method { background: rgb(74 222 128 / 0.12) !important; color: var(--xd-post) !important; border-color: rgb(74 222 128 / 0.35); }
.swagger-ui .opblock.opblock-put .opblock-summary-method { background: rgb(251 191 36 / 0.12) !important; color: var(--xd-put) !important; border-color: rgb(251 191 36 / 0.35); }
.swagger-ui .opblock.opblock-patch .opblock-summary-method { background: rgb(45 212 191 / 0.12) !important; color: var(--xd-patch) !important; border-color: rgb(45 212 191 / 0.35); }
.swagger-ui .opblock.opblock-delete .opblock-summary-method { background: rgb(248 113 113 / 0.12) !important; color: var(--xd-delete) !important; border-color: rgb(248 113 113 / 0.35); }
.swagger-ui .opblock.opblock-head .opblock-summary-method, .swagger-ui .opblock.opblock-options .opblock-summary-method, .swagger-ui .opblock.opblock-deprecated .opblock-summary-method {
  background: rgb(196 181 253 / 0.12) !important; color: var(--xd-other) !important; border-color: rgb(196 181 253 / 0.35);
}
:root[data-theme='light'] .swagger-ui .opblock.opblock-get .opblock-summary-method { background: rgb(29 78 216 / 0.08) !important; border-color: rgb(29 78 216 / 0.25); }
:root[data-theme='light'] .swagger-ui .opblock.opblock-post .opblock-summary-method { background: rgb(20 108 53 / 0.08) !important; border-color: rgb(20 108 53 / 0.25); }
:root[data-theme='light'] .swagger-ui .opblock.opblock-put .opblock-summary-method { background: rgb(180 83 9 / 0.08) !important; border-color: rgb(180 83 9 / 0.25); }
:root[data-theme='light'] .swagger-ui .opblock.opblock-patch .opblock-summary-method { background: rgb(15 118 110 / 0.08) !important; border-color: rgb(15 118 110 / 0.25); }
:root[data-theme='light'] .swagger-ui .opblock.opblock-delete .opblock-summary-method { background: rgb(198 40 40 / 0.08) !important; border-color: rgb(198 40 40 / 0.25); }
:root[data-theme='light'] .swagger-ui .opblock.opblock-head .opblock-summary-method,
:root[data-theme='light'] .swagger-ui .opblock.opblock-options .opblock-summary-method,
:root[data-theme='light'] .swagger-ui .opblock.opblock-deprecated .opblock-summary-method { background: rgb(109 40 217 / 0.08) !important; border-color: rgb(109 40 217 / 0.25); }
.swagger-ui .opblock.opblock-get.is-open { border-left: 3px solid var(--xd-get) !important; }
.swagger-ui .opblock.opblock-post.is-open { border-left: 3px solid var(--xd-post) !important; }
.swagger-ui .opblock.opblock-put.is-open { border-left: 3px solid var(--xd-put) !important; }
.swagger-ui .opblock.opblock-patch.is-open { border-left: 3px solid var(--xd-patch) !important; }
.swagger-ui .opblock.opblock-delete.is-open { border-left: 3px solid var(--xd-delete) !important; }

/* An open operation */
.swagger-ui .opblock .opblock-section-header { background: var(--xd-surface-2) !important; box-shadow: none !important; border-top: 1px solid var(--xd-border); border-bottom: 1px solid var(--xd-border); }
.swagger-ui .opblock .opblock-section-header h4, .swagger-ui .opblock .opblock-section-header label, .swagger-ui .opblock .opblock-section-header > label > span,
.swagger-ui .opblock-title_normal, .swagger-ui .opblock .tab-header .tab-item.active h4 span { color: var(--xd-text) !important; }
.swagger-ui .opblock .tab-header .tab-item.active h4 span:after { background: var(--xd-accent) !important; }
.swagger-ui .opblock-description-wrapper, .swagger-ui .opblock-external-docs-wrapper, .swagger-ui .opblock-title_normal,
.swagger-ui .opblock-description-wrapper p, .swagger-ui .opblock-description-wrapper li, .swagger-ui .opblock-external-docs-wrapper p { color: var(--xd-muted) !important; }
.swagger-ui .opblock-body pre.microlight, .swagger-ui .highlight-code > .microlight, .swagger-ui pre.microlight, .swagger-ui .opblock-body pre {
  background: var(--xd-code-bg) !important; color: #e7e9ee !important; border: 1px solid var(--xd-border); border-radius: 6px !important;
}
.swagger-ui .highlight-code .microlight code, .swagger-ui .microlight code { background: transparent !important; border: none !important; padding: 0; }
.swagger-ui .opblock-body .opblock-loading-animation, .swagger-ui .loading-container .loading:after { color: var(--xd-muted); }

/* Parameters, responses and the tables in them */
.swagger-ui table thead tr td, .swagger-ui table thead tr th { color: var(--xd-muted) !important; border-bottom: 1px solid var(--xd-border) !important; }
.swagger-ui .parameter__name { color: var(--xd-text) !important; }
.swagger-ui .parameter__name.required span, .swagger-ui .parameter__name.required:after { color: var(--xd-danger) !important; }
.swagger-ui .parameter__type, .swagger-ui .parameter__in, .swagger-ui .parameter__extension, .swagger-ui .parameter__deprecated { color: var(--xd-dim) !important; }
.swagger-ui .parameter__enum, .swagger-ui .prop-enum, .swagger-ui .parameter__default, .swagger-ui .parameter__example { color: var(--xd-muted) !important; }
.swagger-ui .parameters-col_description, .swagger-ui .parameters-col_description p, .swagger-ui .parameters-col_description .markdown p { color: var(--xd-muted) !important; }
.swagger-ui .response-col_status { color: var(--xd-text) !important; }
.swagger-ui .response-col_description, .swagger-ui .response-col_links, .swagger-ui .response-col_description p, .swagger-ui .response-col_description__inner p { color: var(--xd-muted) !important; }
.swagger-ui .response-col_links i, .swagger-ui .response-undocumented i { color: var(--xd-dim) !important; }
.swagger-ui .responses-inner h4, .swagger-ui .responses-inner h5, .swagger-ui .request-url, .swagger-ui .request-url pre { color: var(--xd-text) !important; }
.swagger-ui .response-control-media-type__accept-message { color: var(--xd-post) !important; }
.swagger-ui .response-control-media-type__title, .swagger-ui .response-control-media-type--accept-controller label { color: var(--xd-dim) !important; }
.swagger-ui .responses-table .response, .swagger-ui table tbody tr td { border-color: var(--xd-border) !important; }
.swagger-ui table.headers td, .swagger-ui .header-row td, .swagger-ui .headers-wrapper td, .swagger-ui table.headers .header-example { color: var(--xd-muted) !important; }
.swagger-ui .tab li, .swagger-ui .tab li button.tablinks { color: var(--xd-muted) !important; }
.swagger-ui .tab li.active, .swagger-ui .tab li.active button.tablinks { color: var(--xd-text) !important; }
.swagger-ui .tab li:first-of-type:after { background: var(--xd-border-strong); }
.swagger-ui .checkbox p, .swagger-ui label { color: var(--xd-muted); }
.swagger-ui .errors-wrapper { background: rgb(248 113 113 / 0.08) !important; border: 1px solid var(--xd-danger) !important; border-radius: 6px; }
.swagger-ui .errors-wrapper h4, .swagger-ui .errors-wrapper .errors small, .swagger-ui .errors-wrapper .error-line { color: var(--xd-danger) !important; }

/* Schemas */
.swagger-ui section.models { border: 1px solid var(--xd-border) !important; border-radius: 8px; background: var(--xd-surface); margin-top: 56px; }
.swagger-ui section.models h4, .swagger-ui section.models h4 span { color: var(--xd-text) !important; font-family: inherit; }
.swagger-ui section.models h4 svg { fill: var(--xd-dim) !important; }
.swagger-ui section.models.is-open h4 { border-bottom: 1px solid var(--xd-border) !important; }
.swagger-ui section.models .model-container { background: var(--xd-surface-2) !important; border-radius: 6px; }
.swagger-ui section.models .model-container:hover { background: var(--xd-sunken) !important; }
.swagger-ui .model-box { background: transparent !important; }
.swagger-ui .model, .swagger-ui .model-title, .swagger-ui .model .property, .swagger-ui .property-row td, .swagger-ui table.model tr.description, .swagger-ui .model .renderedMarkdown p { color: var(--xd-muted) !important; }
.swagger-ui .model-title, .swagger-ui .model .property-row td:first-of-type { color: var(--xd-text) !important; }
.swagger-ui .model .property.primitive, .swagger-ui .prop-type { color: var(--xd-accent) !important; }
.swagger-ui .prop-format { color: var(--xd-dim) !important; }
.swagger-ui .model-toggle:after, .swagger-ui .model-box-control svg, .swagger-ui .models-control svg { filter: var(--xd-icon-filter); }
.swagger-ui .model .star, .swagger-ui .model span.star { color: var(--xd-danger) !important; }
.swagger-ui .model-hint { background: var(--xd-text); color: var(--xd-bg); }

/* The Authorize dialog */
.swagger-ui .dialog-ux .backdrop-ux { background: var(--xd-backdrop) !important; }
.swagger-ui .dialog-ux .modal-ux { background: var(--xd-surface) !important; border: 1px solid var(--xd-border-strong) !important; border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45) !important; }
.swagger-ui .dialog-ux .modal-ux-header { border-bottom: 1px solid var(--xd-border) !important; }
.swagger-ui .dialog-ux .modal-ux-header h3 { color: var(--xd-text) !important; }
.swagger-ui .dialog-ux .modal-ux-header .close-modal svg { fill: var(--xd-muted); }
.swagger-ui .dialog-ux .modal-ux-content p, .swagger-ui .dialog-ux .modal-ux-content label, .swagger-ui .dialog-ux .modal-ux-content h4,
.swagger-ui .dialog-ux .modal-ux-content h5, .swagger-ui .dialog-ux .modal-ux-content h6, .swagger-ui .dialog-ux .modal-ux-content code,
.swagger-ui .auth-container h4, .swagger-ui .auth-container h6, .swagger-ui .auth-container p, .swagger-ui .scope-def p { color: var(--xd-muted) !important; }
.swagger-ui .dialog-ux .modal-ux-content h4, .swagger-ui .auth-container h4 { color: var(--xd-text) !important; }
.swagger-ui .auth-container { border-bottom: 1px solid var(--xd-border) !important; }
.swagger-ui .auth-container code { background: var(--xd-surface-2) !important; color: var(--xd-code) !important; }

/* Scrollbars */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: var(--xd-bg); }
::-webkit-scrollbar-thumb { background: var(--xd-border-strong); border-radius: 5px; border: 2px solid var(--xd-bg); }
`;
