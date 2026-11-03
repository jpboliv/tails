// Shared by the rendered/source readers. Native anchors still handle scrolling and history.
export const DOCUMENT_NAV_JS = String.raw`
(function () {
  var side = document.querySelector(".docnav"), sections = [], byId = new Map();
  var current = null, pinned = null, pinY = null, revision = 0, queued = false;
  document.querySelectorAll("a[data-toc]").forEach(function (link) {
    var heading = document.getElementById(link.dataset.toc);
    if (!heading) return;
    var section = byId.get(heading.id);
    if (!section) {
      section = { heading: heading, links: [] };
      byId.set(heading.id, section);
      sections.push(section);
    }
    section.links.push(link);
  });
  function target(hash) {
    try { return document.getElementById(decodeURIComponent(hash.slice(1))); } catch (e) { return null; }
  }
  function reveal(element) {
    if (!element) return;
    var folded = element.closest("details:not([open])"), opened = false;
    while (folded) {
      folded.open = true;
      opened = true;
      folded = folded.parentElement.closest("details:not([open])");
    }
    if (opened) element.scrollIntoView();
  }
  // Line and requirement anchors belong to the nearest preceding outline heading.
  function sectionAt(element) {
    var section = null;
    if (!element) return section;
    for (var entry of sections) {
      var h = entry.heading;
      if (h === element || h.contains(element) || (h.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)) section = entry;
      else break;
    }
    return section;
  }
  function select(section) {
    if (section === current) return;
    if (current) current.links.forEach(function (a) { a.removeAttribute("aria-current"); });
    current = section;
    if (!section) return;
    section.links.forEach(function (a) {
      a.setAttribute("aria-current", "location");
      var nav = a.closest(".toc");
      for (var folded = a.closest("details"); folded && nav.contains(folded); folded = folded.parentElement.closest("details")) folded.open = true;
    });
    if (!side || !side.getClientRects().length) return;
    var link = section.links.find(function (a) { return side.contains(a); });
    if (!link) return;
    var r = link.getBoundingClientRect(), s = side.getBoundingClientRect();
    if (r.top < s.top + 8 || r.bottom > s.bottom - 8) side.scrollTop += r.top - s.top - s.height / 3;
  }
  function spy() {
    queued = false;
    // Several anchors can share the same scroll position near the end of a document.
    if (pinned && pinned.heading.getClientRects().length && (pinY === null || Math.abs(scrollY - pinY) < 2)) { select(pinned); return; }
    pinned = null;
    var at = null;
    for (var section of sections) {
      var h = section.heading;
      if (!h.getClientRects().length) continue;
      if (!at) at = section;
      if (h.getBoundingClientRect().top <= 73) at = section;
      else break;
    }
    select(at);
  }
  function schedule() {
    if (!queued) { queued = true; requestAnimationFrame(spy); }
  }
  function pin(section) {
    pinned = section;
    pinY = null;
    var ownRevision = ++revision;
    select(section);
    // Let the browser finish its native anchor jump before watching for further scrolling.
    requestAnimationFrame(function () {
      if (ownRevision !== revision) return;
      pinY = scrollY;
      schedule();
    });
  }
  function followHash() {
    var element = target(location.hash);
    reveal(element);
    pin(sectionAt(element));
  }
  document.addEventListener("click", function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var link = event.target.closest("a[href]");
    if (!link) return;
    var url = new URL(link.href, location.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search || !url.hash) return;
    var element = target(url.hash);
    if (element) { reveal(element); pin(sectionAt(element)); }
  });
  document.querySelectorAll("a[data-keep-hash]").forEach(function (a) {
    a.addEventListener("click", function () {
      var element = pinned ? target(location.hash) : current ? current.heading : target(location.hash);
      // Both readers have source-line anchors; only the rendered reader has heading slugs.
      if (element && /^H[1-6]$/.test(element.tagName)) element = element.querySelector('.la[id^="L"]');
      a.href = a.href.split("#")[0] + (element ? "#" + encodeURIComponent(element.id) : "");
    });
  });
  addEventListener("hashchange", followHash);
  addEventListener("load", followHash);
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", function () { if (pinned) pin(pinned); else schedule(); });
  document.querySelectorAll(".md details").forEach(function (folded) { folded.addEventListener("toggle", schedule); });
  followHash();
  function edge() {
    if (!side) return;
    var wide = side.scrollWidth > side.clientWidth + 1;
    side.toggleAttribute("data-wide", wide);
    side.toggleAttribute("data-end", wide && side.scrollLeft + side.clientWidth >= side.scrollWidth - 2);
  }
  if (side) { edge(); side.addEventListener("scroll", edge, { passive: true }); addEventListener("resize", edge); side.addEventListener("toggle", edge, true); }
})();`;
