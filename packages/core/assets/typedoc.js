// Prepend the mermaid-lint logo to the header title link.
//
// The favicon TypeDoc emits is the same brand icon, so we reuse its resolved
// URL rather than hard-coding an asset path (which varies with page depth).
// Runs defensively: if the expected DOM is absent, it simply does nothing.
(() => {
  const init = () => {
    const title = document.querySelector('.tsd-toolbar-contents .title');
    if (!title || title.querySelector('.ml-logo')) return;

    const favicon = document.querySelector('link[rel~="icon"]');
    if (!favicon) return;

    const logo = document.createElement('img');
    logo.className = 'ml-logo';
    logo.src = favicon.href;
    logo.alt = '';
    logo.setAttribute('aria-hidden', 'true');
    title.prepend(logo);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
