// ---- Ascent program: Hi ${name}, you scored ${score}. ${note} ----
function runProgram(name, score) {
  const grade = score >= 90 ? 'Honors' : score >= 50 ? 'Pass' : 'Fail';
  const note = {
    Honors: 'Outstanding work!',
    Pass:   'Nicely done!',
    Fail:   "Keep going, you'll get there!",
  }[grade];
  return `Hi ${name}, you scored ${score}. ${note}`;
}

// ---- Modal ----
const modal           = document.getElementById('outputModal');
const modalLabel      = document.getElementById('modalLabel');
const inputView       = document.getElementById('modalInputView');
const outputView      = document.getElementById('modalOutputView');
const comingSoonView  = document.getElementById('modalComingSoonView');
const argsForm        = document.getElementById('argsForm');
const runSubmitBtn    = document.getElementById('runSubmitBtn');
const outputText      = document.getElementById('outputText');

function showView(view, label) {
  for (const v of [inputView, outputView, comingSoonView]) v.hidden = v !== view;
  modalLabel.textContent = label;
}

document.getElementById('runBtn').addEventListener('click', () => {
  showView(inputView, 'Inputs');
  modal.showModal();
});

document.getElementById('openEditorBtn').addEventListener('click', e => {
  e.preventDefault();
  showView(comingSoonView, 'Coming soon');
  modal.showModal();
});

argsForm.addEventListener('submit', e => {
  e.preventDefault();
  const name  = document.getElementById('argName').value.trim();
  const score = parseInt(document.getElementById('argScore').value, 10);

  runSubmitBtn.disabled    = true;
  runSubmitBtn.textContent = 'Running...';

  setTimeout(() => {
    runSubmitBtn.disabled    = false;
    runSubmitBtn.textContent = 'Run';
    outputText.textContent = runProgram(name, score);
    showView(outputView, 'Output');
  }, 420);
});

document.getElementById('runAgainBtn').addEventListener('click', () => showView(inputView, 'Inputs'));
document.getElementById('modalClose').addEventListener('click', () => modal.close());
modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });

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
