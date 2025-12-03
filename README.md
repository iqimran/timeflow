# TimeFlow (PHP + MySQL Web)

## 1) Setup
- Import the schema into MySQL:
  ```sql
  SOURCE schema.mysql.sql;
  ```
- Copy `.env.example` to `.env` (same folder as `api.php`) and set DB credentials.

## 2) Run locally
- Configure your web server (Apache/Nginx with PHP) to serve `public/` as the web root.
- Place `api.php`, `db.php`, `.env`, and `schema.mysql.sql` one level above `public/`.
- Ensure PHP can read the `.env` file.

### Apache example
```
DocumentRoot /var/www/timeflow-web/public
<Directory /var/www/timeflow-web>
    AllowOverride All
    Require all granted
</Directory>
```

## 3) Deploy on AWS
- Use Lightsail LAMP or EC2 (Apache + PHP) and MySQL (or RDS).
- Upload the whole folder. Keep `public/` as web root.
- Import `schema.mysql.sql` to MySQL/RDS.
- Set `.env` with RDS endpoint and credentials.
- Protect everything outside `public/` from web access.
- Add HTTPS via ACM/ALB or Lightsail SSL.
