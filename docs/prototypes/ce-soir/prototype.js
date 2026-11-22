const controls = document.querySelector('.controls');
const demoStatus = document.querySelector('#demo-status');
const selection = document.querySelector('#selection');

controls.addEventListener('submit', (event) => {
  event.preventDefault();
  const mood = controls.querySelector('input[name="mood"]:checked');
  const label = mood.labels[0].textContent.trim();

  demoStatus.textContent = `${label} · sélection de démonstration fixe`;
  selection.focus();
});
