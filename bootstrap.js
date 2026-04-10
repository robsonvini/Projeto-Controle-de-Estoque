(async function () {
  async function loadApp() {
    const response = await fetch('app.jsx', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Falha ao carregar app.jsx');
    }

    const source = await response.text();
    const transformed = Babel.transform(source, {
      presets: ['react', 'env']
    }).code;

    // Executa o app transpilado sem usar script inline, que pode ser bloqueado pelo CSP.
    (0, eval)(transformed);
  }

  if (window.Babel) {
    await loadApp();
    return;
  }

  const waitForBabel = setInterval(async () => {
    if (!window.Babel) {
      return;
    }

    clearInterval(waitForBabel);
    try {
      await loadApp();
    } catch (error) {
      console.error(error);
      const root = document.getElementById('root');
      if (root) {
        root.innerHTML = '<div style="padding:24px;color:#b91c1c;font-family:Inter, sans-serif">Falha ao iniciar a aplicação React.</div>';
      }
    }
  }, 50);
})();
