// ---- Run button: reveal the output strip ----
(function(){
  var btn = document.getElementById('runBtn');
  var out = document.getElementById('output');
  if(!btn || !out) return;
  var ran = false;
  btn.addEventListener('click', function(){
    if(ran){ out.classList.remove('open'); ran=false; btn.lastChild.textContent='Run'; return; }
    btn.setAttribute('disabled','');
    btn.lastChild.textContent='Running…';
    setTimeout(function(){
      out.classList.add('open');
      btn.removeAttribute('disabled');
      btn.lastChild.textContent='Run again';
      ran = true;
    }, 420);
  });
})();

// ---- Reveal on scroll ----
(function(){
  var els = document.querySelectorAll('.reveal');
  if(!('IntersectionObserver' in window)){ els.forEach(function(e){e.classList.add('in');}); return; }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); } });
  }, {threshold:0.14, rootMargin:'0px 0px -40px 0px'});
  els.forEach(function(e){ io.observe(e); });
})();
