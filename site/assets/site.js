/* eslint-env browser */

const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    const expanded = navToggle.getAttribute('aria-expanded') === 'true';
    navToggle.setAttribute('aria-expanded', String(!expanded));
    navToggle.textContent = expanded ? 'Menu' : 'Close';
    navLinks.classList.toggle('is-open', !expanded);
  });

  navLinks.addEventListener('click', (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      navToggle.setAttribute('aria-expanded', 'false');
      navToggle.textContent = 'Menu';
      navLinks.classList.remove('is-open');
    }
  });
}

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const value = button.getAttribute('data-copy');
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      const previous = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => {
        button.textContent = previous;
      }, 1200);
    } catch {
      button.textContent = 'Select';
    }
  });
}

for (const code of document.querySelectorAll('.docs-content pre')) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'code-copy';
  button.textContent = 'Copy';
  button.setAttribute('aria-label', 'Copy code block');
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.textContent || '');
      button.textContent = 'Copied';
      setTimeout(() => {
        button.textContent = 'Copy';
      }, 1200);
    } catch {
      button.textContent = 'Select code';
    }
  });
  code.append(button);
}
