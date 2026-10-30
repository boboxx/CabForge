<?php

declare(strict_types=1);

// App shell. Asset URLs carry a version so browsers pick up new files after
// a deploy, even where Apache can't send no-cache headers.
$asset = static function (string $path): string {
    $mtime = @filemtime(__DIR__ . '/' . $path);
    return htmlspecialchars($path . '?v=' . ($mtime ?: '0'), ENT_QUOTES);
};

// Scripts import each other by plain relative paths, which the version on
// app.js doesn't reach. One version (the newest script) goes on every module
// through an import map, so changing any file reloads them all.
$modules = array_merge(glob(__DIR__ . '/assets/js/*.js') ?: [], glob(__DIR__ . '/assets/js/*/*.js') ?: []);
$version = (string) max(array_map('filemtime', $modules) ?: [0]);
$imports = [];
foreach ($modules as $file) {
    $path = './' . substr($file, strlen(__DIR__) + 1);
    $imports[$path] = $path . '?v=' . $version;
}
$importMap = json_encode(['imports' => $imports], JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_THROW_ON_ERROR);

header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>CabForge</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='3' y='3' width='26' height='26' rx='4' fill='%232563eb'/%3E%3Crect x='8' y='8' width='7' height='16' fill='white'/%3E%3Crect x='17' y='8' width='7' height='16' fill='white'/%3E%3C/svg%3E">
    <link rel="stylesheet" href="<?= $asset('assets/css/app.css') ?>">
    <script type="importmap"><?= $importMap ?></script>
    <script type="module" src="./assets/js/app.js?v=<?= $version ?>"></script>
</head>
<body>
    <div id="app"></div>
    <noscript>CabForge needs JavaScript enabled.</noscript>
</body>
</html>
