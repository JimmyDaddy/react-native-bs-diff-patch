/* eslint-env browser */

const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');
const localized = document.documentElement.lang === 'zh-CN';
const ui = localized
  ? {
      close: '关闭',
      copy: '复制',
      copied: '已复制',
      menu: '菜单',
      select: '请选择',
      selectCode: '选择代码',
    }
  : {
      close: 'Close',
      copy: 'Copy',
      copied: 'Copied',
      menu: 'Menu',
      select: 'Select',
      selectCode: 'Select code',
    };

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    const expanded = navToggle.getAttribute('aria-expanded') === 'true';
    navToggle.setAttribute('aria-expanded', String(!expanded));
    navToggle.textContent = expanded
      ? navToggle.dataset.closedLabel || ui.menu
      : navToggle.dataset.openLabel || ui.close;
    navLinks.classList.toggle('is-open', !expanded);
  });

  navLinks.addEventListener('click', (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      navToggle.setAttribute('aria-expanded', 'false');
      navToggle.textContent = navToggle.dataset.closedLabel || ui.menu;
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
      button.textContent = ui.copied;
      setTimeout(() => {
        button.textContent = previous;
      }, 1200);
    } catch {
      button.textContent = ui.select;
    }
  });
}

for (const code of document.querySelectorAll('.docs-content pre')) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'code-copy';
  button.textContent = ui.copy;
  button.setAttribute(
    'aria-label',
    localized ? '复制代码块' : 'Copy code block'
  );
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.textContent || '');
      button.textContent = ui.copied;
      setTimeout(() => {
        button.textContent = ui.copy;
      }, 1200);
    } catch {
      button.textContent = ui.selectCode;
    }
  });
  code.append(button);
}
