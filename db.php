<?php
declare(strict_types=1);

function env(string $key, ?string $def=null): ?string {
  static $env = null;
  if ($env === null) {
    $env = [];
    $path = __DIR__ . '.env';
    if (is_file($path)) {
      foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (!str_contains($line, '=')) continue;
        [$k, $v] = explode('=', $line, 2);
        $env[trim($k)] = trim($v);
      }
    }
  }
  return $env[$key] ?? $def;
}

function db(): PDO {
  static $pdo = null;

  if ($pdo) return $pdo;

  $host = env('DB_HOST', '127.0.0.1');
  $port = env('DB_PORT', '3306');
  $db   = env('DB_NAME', 'timeflow');
  $user = env('DB_USER', 'root');
  $pass = env('DB_PASS', 'Root@123');
  $dsn  = "mysql:host=$host;port=$port;dbname=$db;charset=utf8mb4";

  try {
    $pdo = new PDO($dsn, $user, $pass, [
      PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
  } catch (PDOException $e) {
    die("Database connection failed: " . $e->getMessage());
  }

  return $pdo;
}

function uid(): string {
  return bin2hex(random_bytes(4)); // 8-hex chars
}

function json_input(): array {
  $raw = file_get_contents('php://input');
  return $raw ? (json_decode($raw, true) ?: []) : [];
}

function ok($data, int $code=200) {
  http_response_code($code);
  header('Content-Type: application/json');
  echo json_encode($data);
  exit;
}

function fail(string $msg, int $code=400) {
  http_response_code($code);
  header('Content-Type: application/json');
  echo json_encode(['error' => $msg]);
  exit;
}

function cors() {
  $origins = trim((string)env('CORS_ORIGINS', ''));
  if ($origins !== '') {
    $allowed = array_map('trim', explode(',', $origins));
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (in_array($origin, $allowed, true)) {
      header("Access-Control-Allow-Origin: $origin");
      header("Vary: Origin");
    }
  }
  header('Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type');
  if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
  }
}
