// ---- Run button: show output in modal ----
const btn = document.getElementById('runBtn');
const modal = document.getElementById('outputModal');

if (btn && modal) {
  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.lastChild.textContent = 'Running...';
    setTimeout(() => {
      btn.disabled = false;
      btn.lastChild.textContent = 'Run';
      modal.showModal();
    }, 420);
  });

  document.getElementById('modalClose').addEventListener('click', () => modal.close());

  modal.addEventListener('click', e => {
    if (e.target === modal) modal.close();
  });
}

// ---- Reveal on scroll ----
const revealEls = document.querySelectorAll('.reveal');

const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      entry.target.classList.add('in');
      observer.unobserve(entry.target);
    }
  }
}, { threshold: 0.14, rootMargin: '0px 0px -40px 0px' });

for (const el of revealEls) {
  observer.observe(el);
}
