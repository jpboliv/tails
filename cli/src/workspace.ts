// Presentation and progressive browsing for the three report landing pages.
// Kept separate from the document reader's styles and behaviour.
import { esc } from "./render-md.js";

const ICONS = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  findings: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v.01"/>',
  docs: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6M8 13h8m-8 4h5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
} as const;

export const icon = (name: keyof typeof ICONS): string =>
  `<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

export function browseControls(noun: string, choices: readonly { key: string; label: string; count: number }[]): string {
  return `<div class="browse-controls" data-browse-controls hidden>
<div class="browse-options" role="group" aria-label="Filter ${esc(noun)}">${choices.map((c) => `<button type="button" data-choice="${esc(c.key)}" aria-pressed="${c.key === "all"}" aria-controls="browse-results">${esc(c.label)}<span>${c.count}</span></button>`).join("")}</div>
<label class="browse-search">${icon("search")}<span class="sr-only">Search ${esc(noun)}</span><input type="search" placeholder="Search ${esc(noun)}…" autocomplete="off" aria-controls="browse-results"></label>
<output aria-live="polite" aria-atomic="true"></output></div>`;
}

export const browseEmpty = `<div class="browse-empty" data-browse-empty hidden>${icon("search")}<h2>No matches</h2><p>Try another search or filter.</p><button type="button" class="action" data-browse-reset>Clear filters</button></div>`;

// All content is present without JavaScript. Hash navigation always reveals its target,
// including when a previous search or severity choice would otherwise hide it.
export const BROWSE_JS = `(function(){
document.querySelectorAll("[data-browser]").forEach(function(root){
var controls=root.querySelector("[data-browse-controls]");if(!controls)return;
var input=controls.querySelector("input"),buttons=controls.querySelectorAll("[data-choice]"),output=controls.querySelector("output"),items=Array.from(root.querySelectorAll("[data-item]")),groups=root.querySelectorAll("[data-browse-group]"),empty=root.querySelector("[data-browse-empty]"),choice="all";
var texts=items.map(function(item){return item.textContent.toLowerCase()});
function apply(){var q=input.value.trim().toLowerCase(),n=0;
items.forEach(function(item,i){var hit=(choice==="all"||item.dataset.category===choice)&&(!q||texts[i].indexOf(q)!==-1);item.hidden=!hit;if(hit)n++});
groups.forEach(function(group){var rows=Array.from(group.querySelectorAll("[data-item]")),shown=rows.filter(function(row){return !row.hidden}).length;group.hidden=shown===0;var count=group.querySelector("[data-group-count]");if(count)count.textContent=shown===rows.length?String(shown):shown+" of "+rows.length});
buttons.forEach(function(button){button.setAttribute("aria-pressed",String(button.dataset.choice===choice))});
output.textContent=n+" of "+items.length+" "+root.dataset.browser+" shown";empty.hidden=n!==0}
function reset(){choice="all";input.value="";apply()}
buttons.forEach(function(button){button.addEventListener("click",function(){choice=button.dataset.choice;apply()})});
input.addEventListener("input",apply);root.querySelector("[data-browse-reset]").addEventListener("click",function(){reset();input.focus()});
function reveal(){var target;try{target=document.getElementById(decodeURIComponent(location.hash.slice(1)))}catch(e){}if(!target||!root.contains(target))return;if(target.closest("[hidden]")){reset();target.scrollIntoView()}}
controls.hidden=false;apply();reveal();addEventListener("hashchange",reveal);
});
})();`;

// These styles are scoped to the landing pages; the shared app bar keeps its 48px height
// so document section links and the reader's sticky tree keep their existing offsets.
export const WORKSPACE_CSS = `
.icon{display:inline-block;flex:none;vertical-align:middle}
.primary .icon{width:15px;height:15px;margin-right:7px}
.primary a[aria-current]{color:var(--accent);background:var(--accent-soft);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 15%,transparent)}
.appbar{padding-inline:24px;gap:20px;background:var(--surface)}
.brand{font-size:17px;letter-spacing:-.04em}
.brand .mark{width:26px;height:26px}
.source{max-width:36vw}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.workspace{background:color-mix(in srgb,var(--panel) 55%,var(--bg))}
.workspace main{max-width:1200px;padding:46px 32px 72px;overflow-wrap:anywhere}
.workspace h2{font-size:17px;letter-spacing:-.025em}
.workspace :is(h2,section[id]){scroll-margin-top:72px}
.workspace .eyebrow{font-size:10px;font-weight:650;letter-spacing:.12em;text-transform:uppercase}
.workspace-head{margin-bottom:28px}
.workspace-meta{display:flex;align-items:center;gap:12px;flex-wrap:wrap;color:var(--text-3);font-size:12px;margin-bottom:20px}
.local-label{display:inline-flex;align-items:center;gap:7px;color:var(--text-2);border:1px solid var(--line);border-radius:6px;padding:3px 8px;background:var(--surface);font-size:11px}
.local-label::before{content:"";width:5px;height:5px;background:var(--accent);border-radius:50%}
.workspace-title{display:flex;justify-content:space-between;align-items:center;gap:24px}
.workspace-title>div{min-width:0}
.workspace h1{font-size:clamp(28px,3.2vw,40px);font-weight:650;line-height:1.15;letter-spacing:-.045em;margin:8px 0 12px}
.workspace .lede{font-size:14px;max-width:65ch;margin:0;line-height:1.65}
.action{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:38px;padding:8px 13px;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface);font:500 12px/1.4 var(--font);color:var(--text);cursor:pointer;text-decoration:none;flex:none;transition:background-color .15s,border-color .15s}
.action:hover{text-decoration:none;background:var(--hover);border-color:var(--accent)}
.action.primary-action{background:var(--accent);color:var(--surface);border-color:var(--accent)}
:root[data-theme="dark"] .action.primary-action{color:#171310}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]) .action.primary-action{color:#171310}}
.workspace .verdict{--status:var(--ok);--status-soft:var(--ok-soft);align-items:center;gap:16px;padding:22px 24px;margin:0 0 16px;background:linear-gradient(110deg,var(--status-soft),transparent 80%),var(--surface);border:1px solid color-mix(in srgb,var(--status) 24%,var(--line));border-radius:12px;box-shadow:var(--shadow)}
.workspace .verdict.fail{--status:var(--err);--status-soft:var(--err-soft)}
.workspace .verdict.warn{--status:var(--warn);--status-soft:var(--warn-soft)}
.workspace .verdict.info{--status:var(--text-2);--status-soft:var(--hover)}
.scope-note{color:var(--text-3);font-size:12px;line-height:1.6;margin:12px 0}
.workspace .verdict .scope-note{margin-top:8px}
.verdict-icon{display:grid;place-items:center;flex:none;width:42px;height:42px;border-radius:12px;color:var(--status);background:var(--status-soft);border:1px solid color-mix(in srgb,var(--status) 18%,transparent)}
.verdict-copy{flex:1;min-width:0}
.workspace .verdict .eyebrow{color:var(--status);margin-bottom:5px}
.workspace .verdict h2{font-size:20px;margin:0 0 5px}
.workspace .verdict p:not(.eyebrow){font-size:13px;max-width:76ch;line-height:1.6}
.workspace .stats{gap:12px;margin:0 0 34px}
.workspace .stat{padding:18px 20px;border-radius:10px;position:relative}
.workspace .stat .stat-label{display:block;font-size:12px;font-weight:500;color:var(--text-2);margin-bottom:12px}
.workspace .stat .n{font-size:32px;font-weight:550;letter-spacing:-.04em;margin-bottom:6px}
.workspace .stat .l{font-size:11px}
.workspace .stat .meter{height:3px;margin-top:16px}
.workspace .stat>.icon{position:absolute;top:17px;right:16px;color:var(--text-3);width:14px;height:14px}
.section-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:32px 0 14px}
.section-head h2{margin:0}
.section-head p{margin:4px 0 0;font-size:12px;color:var(--text-3)}
.section-head>a{font-size:12px;color:var(--accent);white-space:nowrap}
.section-head>a .icon{width:14px;height:14px;margin-left:5px}
.source-stages{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:14px;list-style:none;margin:0;padding:0}
.source-stage{--role:var(--text-3);min-width:0;border:1px solid var(--line);border-radius:12px;background:var(--surface);box-shadow:var(--shadow);overflow:hidden}
.source-stage.prd,.doc-card.prd{--role:var(--prd)}
.source-stage.tdd,.doc-card.tdd{--role:var(--tdd)}
.source-stage.tcs,.doc-card.tcs{--role:var(--tcs)}
.stage-head{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--role) 4%,var(--surface))}
.stage-head .step{display:grid;place-items:center;width:25px;height:25px;border:1px solid color-mix(in srgb,var(--role) 24%,transparent);border-radius:7px;color:var(--role);font:500 11px var(--mono)}
.stage-head h3{font-size:12px;flex:1}
.stage-head>.icon{width:14px;height:14px;color:var(--text-3)}
.stage-source{padding:18px}
.stage-source+.stage-source{border-top:1px solid var(--line)}
.stage-source>header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
.stage-source h4{font-size:14px;line-height:1.5;margin:0 0 8px;letter-spacing:-.01em}
.stage-source h4 a{color:var(--text)}
.stage-source .provenance{font-size:11px;color:var(--text-3);line-height:1.7;margin:0 0 16px}
.stage-docs{display:grid;gap:8px;padding-top:12px;border-top:1px solid var(--line)}
.stage-docs a{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--role)}
.stage-docs .icon{width:14px;height:14px}
.workspace .list{border-radius:10px}
.workspace .list>li+li{border-top:1px solid var(--line)}
.workspace .row{padding:16px 18px;gap:8px 12px}
.workspace .row .t{white-space:normal;font-weight:550}
.workspace .row .sub{font-size:11px;line-height:1.7}
.workspace .row .m{gap:5px}
.workspace .legend{margin-top:12px;font-size:11px}
.workspace .epic .meter{height:5px;margin-top:8px}
.overview-bottom{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:24px}
.overview-bottom>section{min-width:0}
.workspace .finding{border-radius:12px;padding:22px 24px;margin-bottom:16px}
.workspace .finding>header{gap:9px;margin-bottom:12px}
.workspace .finding h3{font-size:15px;flex:1}
.workspace .finding .msg{font-size:13px;line-height:1.7;margin-bottom:18px;color:var(--text-2)}
.workspace .sides{gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))}
.workspace .side{min-width:0;gap:10px}
.workspace .side .eyebrow{display:flex;align-items:center;gap:8px;letter-spacing:.06em}
.workspace .quote{padding:14px 16px;border-radius:8px}
.workspace .quote figcaption{gap:4px 8px;margin-bottom:8px}
.workspace .quote figcaption a{font-size:10px}
.workspace .quote blockquote{font-size:13px;line-height:1.7}
.workspace .finding .todo{margin-top:18px;padding:12px 14px;background:var(--panel);border-radius:7px;font-size:12px;line-height:1.65}
.workspace .finding footer{padding-top:14px;margin-top:16px;border-top:1px solid var(--line);justify-content:space-between;font-size:10px}
.workspace .finding footer details{margin:0;font-size:11px}
.workspace .finding.accepted{background:color-mix(in srgb,var(--panel) 40%,var(--surface))}
.browse-controls{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:16px 0 20px;border-bottom:1px solid var(--line);margin-bottom:24px}
.browse-options{display:flex;gap:4px;flex-wrap:wrap}
.browse-options button{display:flex;align-items:center;gap:8px;min-height:36px;padding:6px 11px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--text-2);font:500 12px var(--font);cursor:pointer}
.browse-options button>span{font:11px var(--mono);padding:2px 5px;border-radius:4px;background:var(--hover);color:var(--text-3)}
.browse-options button:hover{background:var(--hover)}
.browse-options button[aria-pressed="true"]{background:var(--surface);border-color:var(--line-strong);color:var(--text);box-shadow:var(--shadow)}
.browse-options button[aria-pressed="true"]>span{background:var(--accent-soft);color:var(--accent)}
.browse-search{display:flex;align-items:center;gap:8px;min-height:36px;border:1px solid var(--line-strong);border-radius:7px;background:var(--surface);padding:0 10px;margin-left:auto;max-width:100%;color:var(--text-3)}
.browse-search .icon{width:15px;height:15px}
.browse-search:focus-within{outline:2px solid var(--focus);outline-offset:2px}
.browse-search input{min-width:0;width:190px;border:0;background:none;outline:none;font:12px var(--font);color:var(--text);height:34px}
.browse-controls output{flex-basis:100%;font-size:11px;color:var(--text-3)}
.browse-group-head{display:flex;align-items:center;gap:12px;margin:28px 0 16px}
.browse-group-head h2{margin:0;font-size:14px}
.browse-group-head::after{content:"";height:1px;background:var(--line);flex:1}
.browse-group-head [data-group-count]{font:11px var(--mono);color:var(--text-3)}
.browse-empty,.workspace-empty{text-align:center;padding:48px 24px;border:1px dashed var(--line-strong);border-radius:12px;background:var(--surface);color:var(--text-3)}
.browse-empty>.icon,.workspace-empty>.icon{width:28px;height:28px;margin-bottom:12px;color:var(--accent)}
.browse-empty h2,.workspace-empty h2{display:block;margin:0 0 8px;color:var(--text);font-size:18px}
.browse-empty p,.workspace-empty p{font-size:13px}
.browse-empty .action{margin-top:12px}
.doc-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;list-style:none;padding:0;margin:0}
.doc-grid>li{display:flex;min-width:0}
.doc-card{--role:var(--text-3);display:flex;flex-direction:column;width:100%;padding:22px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--text);box-shadow:var(--shadow);transition:border-color .15s,box-shadow .15s}
.doc-card:hover{text-decoration:none;border-color:color-mix(in srgb,var(--role) 55%,var(--line));box-shadow:0 4px 16px var(--hover)}
.doc-card>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}
.doc-symbol{display:grid;place-items:center;width:42px;height:46px;border-radius:8px;color:var(--role);background:color-mix(in srgb,var(--role) 8%,var(--surface));border:1px solid color-mix(in srgb,var(--role) 18%,transparent)}
.doc-symbol .icon{width:22px;height:22px}
.doc-card .eyebrow{color:var(--role);font-size:9px;letter-spacing:.1em;margin-bottom:8px}
.doc-card h3{font-size:17px;font-weight:550;line-height:1.45;letter-spacing:-.025em;margin-bottom:10px}
.doc-card .doc-path{font:10px/1.7 var(--mono);color:var(--text-3);margin-bottom:18px}
.doc-card .doc-revision{font-size:11px;color:var(--text-3);margin-top:auto;margin-bottom:16px;line-height:1.7}
.doc-card footer{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:15px;border-top:1px solid var(--line);font-size:11px;color:var(--text-3)}
.doc-card footer>.icon{margin-left:auto;color:var(--role);width:15px;height:15px}
.workspace .chip{font-size:10px;height:21px;border-radius:5px}
@media(max-width:900px){.overview-bottom{grid-template-columns:1fr;gap:0}.workspace-title>.action{align-self:flex-end}.source-stages{gap:10px}.stage-head,.stage-source{padding:14px}.doc-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.workspace .row .m{justify-content:flex-start}}
@media(max-width:700px){.workspace main{padding:28px 20px 48px}.source-stages{grid-template-columns:1fr}.workspace .verdict{flex-wrap:wrap;padding:20px}.verdict>.action{margin-left:58px}.workspace-title{align-items:flex-start;flex-direction:column;gap:16px}.workspace-title>.action{align-self:flex-start}.workspace .stat{padding:16px}.workspace .stat .n{font-size:28px}.browse-search{margin-left:0;flex:1}.browse-search input{width:100%}.workspace .finding{padding:18px}.workspace .row{grid-template-columns:minmax(0,1fr)}.workspace .row .m{grid-row:2}.workspace .row .sub{grid-column:1}.workspace .section-head{align-items:flex-start}.workspace .section-head>a{white-space:normal;text-align:right}}
@media(max-width:599px){.appbar{padding-inline:10px;gap:8px}.primary .icon{display:none}.brand .mark{width:24px;height:24px}.primary a{min-height:34px}.workspace .doc-grid{grid-template-columns:1fr}.workspace main{padding-inline:16px}.workspace .verdict h2{font-size:18px}.workspace .verdict-icon{width:34px;height:34px}.verdict>.action{margin-left:50px}.workspace .stat .stat-label{font-size:11px}.workspace .stat>.icon{display:none}.workspace-meta{gap:8px}.browse-options{width:100%}.browse-options button{padding-inline:8px;gap:6px}.workspace .finding footer{align-items:flex-start;flex-direction:column}.workspace .quote{padding:12px}.workspace .stats{gap:8px}}
@media print{.browse-controls,.browse-empty,.workspace-title>.action,.verdict>.action{display:none!important}.workspace{background:#fff}.workspace main{max-width:none;padding:0}.source-stage,.doc-card{break-inside:avoid}.workspace .finding{box-shadow:none}.workspace .source-stages,.workspace .doc-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
`.trim().replace(/\n/g, "");
