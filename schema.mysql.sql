CREATE DATABASE IF NOT EXISTS timeflow CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE timeflow;

CREATE TABLE IF NOT EXISTS clients (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  email VARCHAR(255),
  currency VARCHAR(12) DEFAULT 'USD',
  defaultRate DECIMAL(10,2) DEFAULT 0,
  terms TEXT,
  payoneer_accountEmail VARCHAR(255),
  payoneer_receivingAccount VARCHAR(255),
  payoneer_memo VARCHAR(255),
  bank_accountName VARCHAR(255),
  bank_bankName VARCHAR(255),
  bank_accountNumberOrIBAN VARCHAR(64),
  bank_swiftBic VARCHAR(32),
  bank_branch VARCHAR(255),
  bank_referenceNote VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(32) PRIMARY KEY,
  clientId VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  rateOverride DECIMAL(10,2) NULL,
  status ENUM('active','archived') DEFAULT 'active',
  CONSTRAINT fk_projects_client FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS todos (
  id VARCHAR(32) PRIMARY KEY,
  projectId VARCHAR(32) NOT NULL,
  title VARCHAR(255) NOT NULL,
  estimateMinutes INT,
  status ENUM('open','done') DEFAULT 'open',
  CONSTRAINT fk_todos_project FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS timeEntries (
  id VARCHAR(32) PRIMARY KEY,
  todoId VARCHAR(32) NULL,
  clientId VARCHAR(32) NOT NULL,
  projectId VARCHAR(32) NOT NULL,
  startAt DATETIME NOT NULL,
  endAt DATETIME NOT NULL,
  durationSeconds INT NOT NULL,
  note TEXT,
  billable TINYINT(1) DEFAULT 1,
  invoiced TINYINT(1) DEFAULT 0,
  CONSTRAINT fk_time_client FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_time_project FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_time_todo FOREIGN KEY (todoId) REFERENCES todos(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id VARCHAR(32) PRIMARY KEY,
  clientId VARCHAR(32) NOT NULL,
  number INT NOT NULL,
  issueDate DATE NOT NULL,
  dueDate DATE NOT NULL,
  currency VARCHAR(12) NOT NULL,
  status ENUM('draft','sent','paid') DEFAULT 'draft',
  hoursSeconds INT DEFAULT 0,
  subtotal DECIMAL(12,2) DEFAULT 0,
  tax DECIMAL(12,2) DEFAULT 0,
  discount DECIMAL(12,2) DEFAULT 0,
  grandTotal DECIMAL(12,2) DEFAULT 0,
  pdfPath TEXT NULL,
  CONSTRAINT fk_inv_client FOREIGN KEY (clientId) REFERENCES clients(id)
);
CREATE UNIQUE INDEX idx_invoices_number ON invoices(number);

CREATE TABLE IF NOT EXISTS invoiceLines (
  id VARCHAR(32) PRIMARY KEY,
  invoiceId VARCHAR(32) NOT NULL,
  timeEntryId VARCHAR(32) NULL,
  date DATE,
  description TEXT,
  hoursSeconds INT,
  rate DECIMAL(10,2),
  amount DECIMAL(12,2),
  projectName VARCHAR(255),
  start TIME,
  `end` TIME,
  CONSTRAINT fk_line_invoice FOREIGN KEY (invoiceId) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS counters (
  `key` VARCHAR(64) PRIMARY KEY,
  `value` INT
);
INSERT IGNORE INTO counters(`key`,`value`) VALUES ('invoice', 1001);
