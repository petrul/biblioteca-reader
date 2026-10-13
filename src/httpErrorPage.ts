export function renderServerErrorPage(assetBasePath: string): string {
  const basePath = assetBasePath.replace(/\/+$/, '');
  const imagePath = `${basePath}/500.jpeg`;
  const libraryPath = `${basePath}/`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Server error — Biblioteca</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 2rem 1.5rem; background: #fcf9f2; color: #08231c; font: 16px system-ui, sans-serif; text-align: center; }
    main { max-width: 32rem; }
    img { display: block; width: min(420px, 80vw); height: auto; margin: 0 auto 2rem; border-radius: 1rem; box-shadow: 0 20px 50px -20px rgba(8, 35, 28, .35); }
    h1 { font-family: Georgia, serif; font-size: clamp(1.5rem, 4vw, 2.25rem); }
    p { line-height: 1.6; opacity: .8; }
    a { display: inline-block; margin-top: 1rem; padding: .7rem 1.4rem; border-radius: .75rem; background: #059669; color: white; font-weight: 600; text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <img src="${imagePath}" alt="A server error among the library stacks">
    <h1>The stacks are temporarily unsettled</h1>
    <p>Something went wrong while serving this page. Please try again in a moment. (5xx)</p>
    <a href="${libraryPath}">Back to the library</a>
  </main>
</body>
</html>`;
}
