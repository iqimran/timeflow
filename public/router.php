<?php
// public/router.php
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// Handle API requests
if (strpos($uri, '/api.php') === 0) {
    // Remove /api.php prefix for routing
    $_SERVER['REQUEST_URI'] = preg_replace('#^/api\.php#', '', $uri);

    // Load the API file from parent directory
    require __DIR__ . '/../api.php';
    exit;
}

// For root path, serve index.html
if ($uri === '/' || $uri === '/index.html') {
    readfile(__DIR__ . '/index.html');
    exit;
}

// Let PHP's built-in server handle other static files
return false;
