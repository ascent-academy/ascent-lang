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

// ---- Modal: two-screen flow (inputs -> output) ----
const btn           = document.getElementById('runBtn');
const modal         = document.getElementById('outputModal');
const modalLabel    = document.getElementById('modalLabel');
const inputView     = document.getElementById('modalInputView');
const outputView    = document.getElementById('modalOutputView');
const argsForm      = document.getElementById('argsForm');
const runSubmitBtn  = document.getElementById('runSubmitBtn');
const outputText    = document.getElementById('outputText');

function showInputs() {
  modalLabel.textContent = 'Inputs';
  outputView.hidden = true;
  inputView.hidden  = false;
}

function showOutput(text) {
  outputText.textContent = text;
  modalLabel.textContent = 'Output';
  inputView.hidden  = true;
  outputView.hidden = false;
}

btn.addEventListener('click', () => {
  showInputs();
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
    showOutput(runProgram(name, score));
  }, 420);
});

document.getElementById('runAgainBtn').addEventListener('click', showInputs);
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
