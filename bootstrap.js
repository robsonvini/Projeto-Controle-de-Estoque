(function () {
    if (document.getElementById('app-bootstrapped')) {
        return;
    }

    const script = document.createElement('script');
    script.id = 'app-bootstrapped';
    script.type = 'text/babel';
    script.src = 'app.jsx';
    script.setAttribute('data-presets', 'env,react');

    document.body.appendChild(script);

    if (window.Babel && typeof window.Babel.transformScriptTags === 'function') {
        window.Babel.transformScriptTags();
    }
}());