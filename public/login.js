(function(){
  const form = document.getElementById('login-form');
  const msg  = document.getElementById('login-msg');
  const btn  = document.getElementById('login-btn');

  async function login(e){
    e.preventDefault();
    msg.textContent = '';
    msg.className = 'msg';
    btn.disabled = true;

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (!username || !password){
      msg.textContent = 'Fyll i användarnamn och lösenord.';
      msg.classList.add('error'); btn.disabled = false; return;
    }

    try{
      const res = await fetch('/api/login', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ username, password })
      });
      const data = await res.json().catch(()=> ({}));

      if (res.ok && data.success){
        msg.textContent = 'Inloggad – skickar dig vidare…';
        msg.classList.add('success');
        location.href = '/admin.html';
      } else {
        msg.textContent = 'Felaktiga uppgifter.';
        msg.classList.add('error');
      }
    } catch (err){
      msg.textContent = 'Något gick fel. Försök igen.';
      msg.classList.add('error');
    } finally {
      btn.disabled = false;
    }
  }

  form.addEventListener('submit', login);
})();
