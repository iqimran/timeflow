<?php

declare(strict_types=1);
require __DIR__ . '/db.php';
cors();

$method = $_SERVER['REQUEST_METHOD'];
$path   = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/';
$path   = rtrim($path, '/');

function rateFor(?array $project, ?array $client): float
{
  if ($project && $project['rateOverride'] !== null) return (float)$project['rateOverride'];
  return (float)($client['defaultRate'] ?? 0);
}

function route($method, $pattern, $handler)
{
  static $routes = [];
  if ($handler !== null) {
    $routes[] = [$method, '#^' . $pattern . '$#', $handler];
    return;
  }
  foreach ($routes as [$m, $re, $h]) {
    if ($m !== $_SERVER['REQUEST_METHOD']) continue;
    if (preg_match($re, rtrim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/'), $m2)) {
      array_shift($m2);
      $h(...$m2);
      return;
    }
  }
  fail('Not found', 404);
}

/* Clients */
route('GET', '/clients', function () {
  $rows = db()->query("SELECT * FROM clients ORDER BY name")->fetchAll();
  ok($rows);
});

route('POST', '/clients', function () {
  $c = json_input();
  if (!($c['name'] ?? '')) fail('Client name required');
  $id = $c['id'] ?? uid();
  $stmt = db()->prepare("
    INSERT INTO clients (id,name,address,email,currency,defaultRate,terms,
      payoneer_accountEmail,payoneer_receivingAccount,payoneer_memo,
      bank_accountName,bank_bankName,bank_accountNumberOrIBAN,bank_swiftBic,bank_branch,bank_referenceNote
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ");
  $stmt->execute([
    $id,
    $c['name'],
    $c['address'] ?? '',
    $c['email'] ?? '',
    $c['currency'] ?? 'USD',
    $c['defaultRate'] ?? 0,
    $c['terms'] ?? '',
    $c['payoneer']['accountEmail'] ?? null,
    $c['payoneer']['receivingAccount'] ?? null,
    $c['payoneer']['memo'] ?? null,
    $c['bank']['accountName'] ?? null,
    $c['bank']['bankName'] ?? null,
    $c['bank']['accountNumberOrIBAN'] ?? null,
    $c['bank']['swiftBic'] ?? null,
    $c['bank']['branch'] ?? null,
    $c['bank']['referenceNote'] ?? null,
  ]);
  ok(['id' => $id] + $c, 201);
});

/* Projects */
route('GET', '/projects', function () {
  $rows = db()->query("SELECT * FROM projects ORDER BY name")->fetchAll();
  ok($rows);
});
route('POST', '/projects', function () {
  $p = json_input();
  if (!($p['name'] ?? '') || !($p['clientId'] ?? '')) fail('Project name + clientId required');
  $id = $p['id'] ?? uid();
  $stmt = db()->prepare("INSERT INTO projects (id,clientId,name,rateOverride,status) VALUES (?,?,?,?,?)");
  $stmt->execute([$id, $p['clientId'], $p['name'], $p['rateOverride'] ?? null, $p['status'] ?? 'active']);
  ok(['id' => $id] + $p, 201);
});

/* Todos */
route('GET', '/todos', function () {
  $rows = db()->query("SELECT * FROM todos ORDER BY id DESC")->fetchAll();
  ok($rows);
});
route('POST', '/todos', function () {
  $t = json_input();
  if (!($t['title'] ?? '') || !($t['projectId'] ?? '')) fail('Todo title + projectId required');
  $id = $t['id'] ?? uid();
  $stmt = db()->prepare("INSERT INTO todos (id,projectId,title,estimateMinutes,status) VALUES (?,?,?,?,?)");
  $stmt->execute([$id, $t['projectId'], $t['title'], $t['estimateMinutes'] ?? 0, $t['status'] ?? 'open']);
  ok(['id' => $id] + $t, 201);
});

/* Time entries */
route('GET', '/time/recent', function () {
  $limit = (int)($_GET['limit'] ?? 200);
  $stmt = db()->prepare("SELECT * FROM timeEntries ORDER BY startAt DESC LIMIT ?");
  $stmt->bindValue(1, $limit, PDO::PARAM_INT);
  $stmt->execute();
  ok($stmt->fetchAll());
});
route('POST', '/time/add', function () {
  $e = json_input();
  foreach (['clientId', 'projectId', 'startAt', 'endAt', 'durationSeconds'] as $k) {
    if (!isset($e[$k])) fail("$k is required");
  }
  if ((int)$e['durationSeconds'] <= 0) fail('durationSeconds must be > 0');

  $pdo = db();
  $client = $pdo->prepare("SELECT * FROM clients WHERE id=?");
  $client->execute([$e['clientId']]);
  $client = $client->fetch();
  if (!$client) fail('Client not found');

  $proj = $pdo->prepare("SELECT * FROM projects WHERE id=?");
  $proj->execute([$e['projectId']]);
  $project = $proj->fetch();
  if (!$project) fail('Project not found');
  if ($project['clientId'] !== $e['clientId']) fail('Project does not belong to client');

  if (!empty($e['todoId'])) {
    $td = $pdo->prepare("SELECT id,projectId FROM todos WHERE id=?");
    $td->execute([$e['todoId']]);
    $todo = $td->fetch();
    if (!$todo) fail('To-do not found');
    if ($todo['projectId'] !== $e['projectId']) fail('To-do does not belong to project');
  }

  $id = $e['id'] ?? uid();
  $stmt = $pdo->prepare("
    INSERT INTO timeEntries (id,todoId,clientId,projectId,startAt,endAt,durationSeconds,note,billable,invoiced)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  ");
  $stmt->execute([
    $id,
    $e['todoId'] ?? null,
    $e['clientId'],
    $e['projectId'],
    $e['startAt'],
    $e['endAt'],
    (int)$e['durationSeconds'],
    $e['note'] ?? '',
    !empty($e['billable']) ? 1 : 0,
    !empty($e['invoiced']) ? 1 : 0
  ]);
  ok(['id' => $id] + $e, 201);
});
route('POST', '/time/markInvoiced', function () {
  $ids = json_input();
  $ids = $ids['ids'] ?? [];
  if (!is_array($ids)) fail('ids[] required');
  $pdo = db();
  $pdo->beginTransaction();
  $stmt = $pdo->prepare("UPDATE timeEntries SET invoiced=1 WHERE id=?");
  foreach ($ids as $id) $stmt->execute([$id]);
  $pdo->commit();
  ok(['updated' => count($ids)]);
});

/* Counters */
route('GET', '/counters/nextInvoice', function () {
  $pdo = db();
  $row = $pdo->query("SELECT value FROM counters WHERE `key`='invoice'")->fetch();
  $num = $row ? (int)$row['value'] : 1001;
  $pdo->prepare("UPDATE counters SET value=? WHERE `key`='invoice'")->execute([$num + 1]);
  ok($num);
});

/* Invoices */
route('GET', '/invoices', function () {
  $rows = db()->query("SELECT * FROM invoices ORDER BY issueDate DESC, number DESC")->fetchAll();
  ok($rows);
});
route('POST', '/invoices', function () {
  $p = json_input();
  $id = uid();
  $pdo = db();

  $pdo->beginTransaction();
  $stmt = $pdo->prepare("
    INSERT INTO invoices
    (id,clientId,number,issueDate,dueDate,currency,status,hoursSeconds,subtotal,tax,discount,grandTotal,pdfPath)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)
  ");
  $stmt->execute([
    $id,
    $p['clientId'],
    $p['number'],
    $p['issueDate'],
    $p['dueDate'],
    $p['currency'],
    $p['status'] ?? 'draft',
    $p['totals']['hoursSeconds'] ?? 0,
    $p['totals']['subtotal'] ?? 0,
    $p['totals']['tax'] ?? 0,
    $p['totals']['discount'] ?? 0,
    $p['totals']['grandTotal'] ?? 0
  ]);

  $lineStmt = $pdo->prepare("
    INSERT INTO invoiceLines
    (id,invoiceId,timeEntryId,date,description,hoursSeconds,rate,amount,projectName,start,`end`)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  ");
  foreach (($p['lines'] ?? []) as $l) {
    $lineStmt->execute([
      uid(),
      $id,
      $l['entryId'] ?? null,
      $l['date'] ?? null,
      $l['description'] ?? '',
      $l['_seconds'] ?? 0,
      $l['rate'] ?? 0,
      $l['amount'] ?? 0,
      $l['project'] ?? '',
      $l['start'] ?? null,
      $l['end'] ?? null,
    ]);
  }
  $pdo->commit();

  ok(['id' => $id] + $p, 201);
});
route('DELETE', '/invoices/([a-f0-9]{8})', function ($invoiceId) {
  $pdo = db();
  $pdo->beginTransaction();
  $ids = $pdo->prepare("SELECT timeEntryId FROM invoiceLines WHERE invoiceId=? AND timeEntryId IS NOT NULL");
  $ids->execute([$invoiceId]);
  $ids = array_map(fn($r) => $r['timeEntryId'], $ids->fetchAll());
  if ($ids) {
    $stmt = $pdo->prepare("UPDATE timeEntries SET invoiced=0 WHERE id=?");
    foreach ($ids as $id) $stmt->execute([$id]);
  }
  $pdo->prepare("DELETE FROM invoiceLines WHERE invoiceId=?")->execute([$invoiceId]);
  $pdo->prepare("DELETE FROM invoices WHERE id=?")->execute([$invoiceId]);
  $pdo->commit();
  ok(['deleted' => true]);
});
route('PATCH', '/invoices/status', function () {
  $p = json_input();
  $id = $p['id'] ?? null;
  $status = $p['status'] ?? null;
  if (!$id || !$status) fail('id + status required');
  $stmt = db()->prepare("UPDATE invoices SET status=? WHERE id=?");
  $stmt->execute([$status, $id]);
  ok(['updated' => true]);
});

/* Metrics */
route('POST', '/metrics/summaryRange', function () {
  $p = json_input();
  $start = $p['startIso'] ?? null;
  $end   = $p['endIso'] ?? null;
  if (!$start || !$end) fail('startIso + endIso required');

  $pdo = db();
  $tot = $pdo->prepare("
     SELECT COALESCE(SUM(durationSeconds),0) AS totalSeconds,
            COALESCE(SUM(CASE WHEN billable=1 THEN durationSeconds END),0) AS billableSeconds
     FROM timeEntries WHERE DATE(startAt) >= DATE(?) AND DATE(endAt) <= DATE(?)
  ");
  $tot->execute([$start, $end]);
  $totals = $tot->fetch();

  $by = $pdo->prepare("
    SELECT c.id AS clientId, c.name AS clientName,
           COALESCE(SUM(te.durationSeconds),0) AS totalSeconds,
           COALESCE(SUM(CASE WHEN te.billable=1 THEN te.durationSeconds END),0) AS billableSeconds
    FROM clients c
    LEFT JOIN timeEntries te
      ON te.clientId=c.id AND DATE(te.startAt) >= DATE(?) AND DATE(te.endAt) <= DATE(?)
    GROUP BY c.id, c.name
    ORDER BY totalSeconds DESC, c.name ASC
  ");
  $by->execute([$start, $end]);
  $byClient = $by->fetchAll();
  ok(['totals' => $totals, 'byClient' => $byClient]);
});
route('GET', '/metrics/uninvoicedAmount', function () {
  $pdo = db();
  $rows = $pdo->query("
    SELECT durationSeconds, projectId, clientId
    FROM timeEntries WHERE invoiced=0 AND billable=1
  ")->fetchAll();
  if (!$rows) ok(0);

  $clients = [];
  foreach ($pdo->query("SELECT * FROM clients")->fetchAll() as $c) $clients[$c['id']] = $c;
  $projects = [];
  foreach ($pdo->query("SELECT * FROM projects")->fetchAll() as $p) $projects[$p['id']] = $p;

  $sum = 0.0;
  foreach ($rows as $r) {
    $rate = rateFor($projects[$r['projectId']] ?? null, $clients[$r['clientId']] ?? null);
    $sum += ($r['durationSeconds'] / 3600) * $rate;
  }
  ok(round($sum, 2));
});

/* Invoice preview */
route('POST', '/invoices/preview', function () {
  $p = json_input();
  $clientId = $p['clientId'] ?? null;
  $projectId = $p['projectId'] ?? null;
  $startIso = $p['startIso'] ?? null;
  $endIso   = $p['endIso'] ?? null;
  if (!$clientId || !$startIso || !$endIso) fail('clientId + startIso + endIso required');

  $pdo = db();
  $client = $pdo->prepare("SELECT * FROM clients WHERE id=?");
  $client->execute([$clientId]);
  $client = $client->fetch();
  if (!$client) fail('Client not found', 404);

  $sql = "
    SELECT te.*, p.name AS projectName, t.title AS todoTitle
    FROM timeEntries te
    JOIN projects p ON p.id = te.projectId
    LEFT JOIN todos t ON t.id = te.todoId
    WHERE te.clientId = ?
      AND te.invoiced = 0
      AND DATE(te.startAt) >= DATE(?)
      AND DATE(te.endAt)   <= DATE(?)
  ";
  $args = [$clientId, $startIso, $endIso];
  if ($projectId) {
    $sql .= " AND te.projectId=?";
    $args[] = $projectId;
  }
  $sql .= " ORDER BY te.startAt ASC";
  $stmt = $pdo->prepare($sql);
  $stmt->execute($args);
  $rows = $stmt->fetchAll();

  $pmapStmt = $pdo->prepare("SELECT * FROM projects WHERE clientId=?");
  $pmapStmt->execute([$clientId]);
  $projMap = [];
  foreach ($pmapStmt->fetchAll() as $pr) $projMap[$pr['id']] = $pr;

  $lines = [];
  $subtotal = 0.0;
  $hoursSec = 0;
  foreach ($rows as $e) {
    $project = $projMap[$e['projectId']] ?? null;
    $rate = rateFor($project, $client);
    $amount = round(($e['durationSeconds'] / 3600) * $rate, 2);

    $lines[] = [
      'entryId' => $e['id'],
      'date' => substr($e['startAt'], 0, 10),
      'start' => substr($e['startAt'], 11, 8),
      'end'  => substr($e['endAt'], 11, 8),
      'project' => $e['projectName'] ?? '',
      'description' => $e['todoTitle'] ? ($e['todoTitle'] . ($e['note'] ? ' — ' . $e['note'] : '')) : ($e['note'] ?? $e['projectName'] ?? ''),
      '_seconds' => (int)$e['durationSeconds'],
      'displaySeconds' => (int)$e['durationSeconds'],
      'rate' => (float)$rate,
      'amount' => (float)$amount
    ];
    $subtotal += $amount;
    $hoursSec += (int)$e['durationSeconds'];
  }

  $totals = [
    'hoursSeconds' => $hoursSec,
    'subtotal'     => round($subtotal, 2),
    'tax'          => 0,
    'discount'     => 0,
    'grandTotal'   => round($subtotal, 2),
  ];
  ok(['client' => $client, 'lines' => $lines, 'totals' => $totals, 'currency' => $client['currency'] ?: 'USD']);
});

route(null, null, null);
