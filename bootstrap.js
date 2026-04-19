(function () {
    if (window.__APP_BOOTSTRAP_DONE__) {
        return;
    }

    window.__APP_BOOTSTRAP_DONE__ = true;

    // Se o app já foi referenciado diretamente no HTML, não injeta de novo.
    if (document.querySelector('script[src="app.jsx"], script[src*="app.jsx?"]')) {
        return;
    }

    if (document.getElementById('app-bootstrapped')) {
        return;
    }

    const script = document.createElement('script');
    script.id = 'app-bootstrapped';
    script.type = 'text/babel';
    script.src = 'app.jsx';
    script.setAttribute('data-presets', 'env,react');
    script.setAttribute('data-app-entry', 'true');

    document.body.appendChild(script);

    if (window.Babel && typeof window.Babel.transformScriptTags === 'function') {
        window.Babel.transformScriptTags();
    }
}());