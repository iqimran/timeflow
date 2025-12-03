<?php
require __DIR__ . '/db.php';

try {
    $pdo = db();
    echo "✅ Connected successfully!";
} catch (PDOException $e) {
    echo "❌ Connection failed: " . $e->getMessage();
}
