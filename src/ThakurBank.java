import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.*;

/** Thakur Bank - Bank Management System (Java, no external libraries). */
public class ThakurBank {
    static final int PORT = 8080;
    static final double MIN_BALANCE = 500;
    static final String RS = "\u20b9";
    static final Path DATA = Paths.get("data", "bank.dat");
    static final Path WEB = Paths.get("web").toAbsolutePath().normalize();

    // ---- 5 admin accounts (change passwords here) ----
    static final Map<String, String> ADMINS = new LinkedHashMap<>();
    static {
        ADMINS.put("admin1", "Thakur@101");
        ADMINS.put("admin2", "Thakur@102");
        ADMINS.put("admin3", "Thakur@103");
        ADMINS.put("admin4", "Thakur@104");
        ADMINS.put("admin5", "Thakur@105");
    }

    // ---- Models ----
    static class Txn implements Serializable {
        private static final long serialVersionUID = 1L;
        String id, type, desc, time, acc;
        double amount, balance;
        long ts;
    }
    static class FD implements Serializable {
        private static final long serialVersionUID = 1L;
        String id, start; double amount, rate, maturity; int months; boolean open = true; long startMs;
    }
    static class Loan implements Serializable {
        private static final long serialVersionUID = 1L;
        String id, kind, applied, status = "PENDING"; double amount, rate, emi; int months, paid;
    }
    static class Account implements Serializable {
        private static final long serialVersionUID = 1L;
        String number, name, phone, email, salt, hash, created;
        double balance;
        boolean frozen;
        String type = "Savings", cvv, expiry;
        boolean cardFrozen; int fails; long lockUntil;
        List<FD> fds = new ArrayList<>();
        List<Loan> loans = new ArrayList<>();
        List<Txn> txns = new ArrayList<>();
    }
    static class Bank implements Serializable {
        private static final long serialVersionUID = 1L;
        Map<String, Account> accounts = new LinkedHashMap<>();
        long nextNo = 1000100001L;
    }
    static class ApiError extends RuntimeException {
        int code;
        ApiError(int code, String msg) { super(msg); this.code = code; }
    }

    static Bank bank = load();
    static final Map<String, String[]> sessions = new ConcurrentHashMap<>();
    static final SecureRandom RND = new SecureRandom();

    // ---- Persistence ----
    static Bank load() {
        try (ObjectInputStream in = new ObjectInputStream(Files.newInputStream(DATA))) {
            return (Bank) in.readObject();
        } catch (Exception e) { return new Bank(); }
    }
    static void save() {
        try (ObjectOutputStream out = new ObjectOutputStream(Files.newOutputStream(DATA))) {
            out.writeObject(bank);
        } catch (IOException e) { e.printStackTrace(); }
    }

    // ---- Helpers ----
    static String hash(String salt, String pw) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest((salt + pw).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) { throw new RuntimeException(e); }
    }
    static String token() { byte[] b = new byte[24]; RND.nextBytes(b); return Base64.getUrlEncoder().withoutPadding().encodeToString(b); }
    static String now() { return LocalDateTime.now().format(DateTimeFormatter.ofPattern("dd MMM yyyy, hh:mm a")); }
    static String q(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': case '\t': b.append(' '); break;
                default: b.append(c);
            }
        }
        return b.append('"').toString();
    }
    static String m(double d) { return String.format(Locale.US, "%.2f", d); }
    static double minBal(Account a) { return "Current".equals(a.type) ? 1000 : MIN_BALANCE; }
    static String fdJ(FD d) {
        return "{\"id\":" + q(d.id) + ",\"amount\":" + m(d.amount) + ",\"months\":" + d.months + ",\"rate\":" + d.rate + ",\"maturity\":" + m(d.maturity)
            + ",\"start\":" + q(d.start) + ",\"open\":" + d.open + ",\"ready\":" + (System.currentTimeMillis() - d.startMs >= d.months * 30L * 86400000L) + "}";
    }
    static String loanJ(Loan l, Account a) {
        return "{\"id\":" + q(l.id) + ",\"kind\":" + q(l.kind) + ",\"amount\":" + m(l.amount) + ",\"rate\":" + l.rate + ",\"months\":" + l.months + ",\"emi\":" + m(l.emi)
            + ",\"paid\":" + l.paid + ",\"status\":" + q(l.status) + ",\"applied\":" + q(l.applied) + ",\"acc\":" + q(a.number) + ",\"name\":" + q(a.name) + "}";
    }
    static String accJ(Account a) {
        return "{\"type\":" + q(a.type) + ",\"number\":" + q(a.number) + ",\"name\":" + q(a.name) + ",\"phone\":" + q(a.phone) + ",\"email\":" + q(a.email)
            + ",\"balance\":" + m(a.balance) + ",\"frozen\":" + a.frozen + ",\"created\":" + q(a.created) + "}";
    }
    static String txnJ(Txn t) {
        return "{\"id\":" + q(t.id) + ",\"type\":" + q(t.type) + ",\"desc\":" + q(t.desc) + ",\"time\":" + q(t.time)
            + ",\"acc\":" + q(t.acc) + ",\"amount\":" + m(t.amount) + ",\"balance\":" + m(t.balance) + "}";
    }
    static String txnList(List<Txn> l) {
        StringJoiner j = new StringJoiner(",", "[", "]");
        for (Txn t : l) j.add(txnJ(t));
        return j.toString();
    }
    static double num(Map<String, String> f, String key) {
        try {
            double v = Double.parseDouble(f.getOrDefault(key, "").trim());
            if (Double.isNaN(v) || Double.isInfinite(v) || v <= 0 || v > 1000000) throw new NumberFormatException();
            return Math.round(v * 100) / 100.0;
        } catch (NumberFormatException e) {
            throw new ApiError(400, "Enter a valid amount (max " + RS + "10,00,000 per transaction)");
        }
    }
    static void addTxn(Account a, String type, double amt, String desc) {
        Txn t = new Txn();
        t.id = "TXN" + Long.toString(System.currentTimeMillis(), 36).toUpperCase() + RND.nextInt(90) + 10;
        t.type = type; t.amount = amt; t.desc = desc; t.time = now(); t.acc = a.number;
        t.balance = a.balance; t.ts = System.nanoTime() + System.currentTimeMillis() * 1_000_000L;
        a.txns.add(t);
    }
    static String[] need(String[] s, String role) {
        if (s == null || !s[0].equals(role)) throw new ApiError(401, "Please log in first");
        return s;
    }
    static Account user(String[] s) {
        need(s, "user");
        Account a = bank.accounts.get(s[1]);
        if (a == null) throw new ApiError(401, "Account not found");
        if (a.frozen) throw new ApiError(403, "Your account is frozen. Please contact Thakur Bank.");
        return a;
    }

    // ---- Routes ----
    static String route(String path, Map<String, String> f, String[] s, String tok) {
        synchronized (bank) {
            switch (path) {
                case "/api/register": {
                    String name = f.getOrDefault("name", "").trim(), phone = f.getOrDefault("phone", "").trim();
                    String email = f.getOrDefault("email", "").trim(), pw = f.getOrDefault("password", "");
                    if (name.length() < 3) throw new ApiError(400, "Enter your full name");
                    if (!phone.matches("\\d{10}")) throw new ApiError(400, "Phone number must be 10 digits");
                    if (!email.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) throw new ApiError(400, "Enter a valid email");
                    if (pw.length() < 6) throw new ApiError(400, "Password must be at least 6 characters");
                    double dep = num(f, "deposit");
                    String type = "Current".equals(f.get("type")) ? "Current" : "Savings";
                    double minDep = type.equals("Current") ? 1000 : MIN_BALANCE;
                    if (dep < minDep) throw new ApiError(400, "Minimum opening deposit for a " + type + " account is " + RS + (int) minDep);
                    Account a = new Account();
                    a.number = String.valueOf(bank.nextNo++);
                    a.cvv = String.valueOf(100 + RND.nextInt(900)); a.expiry = LocalDateTime.now().plusYears(4).format(DateTimeFormatter.ofPattern("MM/yy"));
                    a.type = type; a.name = name; a.phone = phone; a.email = email; a.created = now();
                    a.salt = token(); a.hash = hash(a.salt, pw); a.balance = dep;
                    addTxn(a, "DEPOSIT", dep, "Opening deposit");
                    bank.accounts.put(a.number, a);
                    save();
                    return "{\"account\":" + q(a.number) + "}";
                }
                case "/api/login": {
                    Account a = bank.accounts.get(f.getOrDefault("account", "").trim());
                    if (a != null && a.lockUntil > System.currentTimeMillis())
                        throw new ApiError(429, "Account locked after 3 wrong attempts. Try again in " + ((a.lockUntil - System.currentTimeMillis()) / 1000 + 1) + " seconds.");
                    if (a == null || !a.hash.equals(hash(a.salt, f.getOrDefault("password", "")))) {
                        if (a != null && ++a.fails >= 3) { a.fails = 0; a.lockUntil = System.currentTimeMillis() + 120000; save(); }
                        throw new ApiError(401, "Invalid account number or password");
                    }
                    a.fails = 0;
                    if (a.frozen) throw new ApiError(403, "Your account is frozen. Please contact Thakur Bank.");
                    String t = token();
                    sessions.put(t, new String[]{"user", a.number});
                    return "{\"token\":" + q(t) + "}";
                }
                case "/api/admin/login": {
                    String u = f.getOrDefault("username", "").trim().toLowerCase();
                    String p = ADMINS.get(u);
                    if (p == null || !MessageDigest.isEqual(p.getBytes(), f.getOrDefault("password", "").getBytes()))
                        throw new ApiError(401, "Invalid admin username or password");
                    String t = token();
                    sessions.put(t, new String[]{"admin", u});
                    return "{\"token\":" + q(t) + ",\"admin\":" + q(u) + "}";
                }
                case "/api/logout":
                    if (tok != null) sessions.remove(tok);
                    return "{\"ok\":true}";
                case "/api/me":
                    return accJ(user(s));
                case "/api/history": {
                    Account a = user(s);
                    List<Txn> l = new ArrayList<>(a.txns);
                    Collections.reverse(l);
                    return txnList(l);
                }
                case "/api/deposit": {
                    Account a = user(s);
                    double amt = num(f, "amount");
                    a.balance = Math.round((a.balance + amt) * 100) / 100.0;
                    addTxn(a, "DEPOSIT", amt, "Cash deposit");
                    save();
                    return accJ(a);
                }
                case "/api/withdraw": {
                    Account a = user(s);
                    if (a.cardFrozen) throw new ApiError(403, "Your card is frozen. Unfreeze it from the Card page.");
                    double amt = num(f, "amount");
                    if (a.balance - amt < minBal(a))
                        throw new ApiError(400, "Insufficient balance. Minimum balance of " + RS + (int) minBal(a) + " must be maintained for a " + a.type + " account.");
                    a.balance = Math.round((a.balance - amt) * 100) / 100.0;
                    addTxn(a, "WITHDRAW", amt, "Cash withdrawal");
                    save();
                    return accJ(a);
                }
                case "/api/transfer": {
                    Account a = user(s);
                    if (a.cardFrozen) throw new ApiError(403, "Your card is frozen. Unfreeze it from the Card page.");
                    double amt = num(f, "amount");
                    String to = f.getOrDefault("to", "").trim();
                    String note = f.getOrDefault("note", "").trim();
                    Account b = bank.accounts.get(to);
                    if (b == null) throw new ApiError(404, "Receiver account not found");
                    if (b == a) throw new ApiError(400, "You cannot transfer to your own account");
                    if (b.frozen) throw new ApiError(400, "Receiver account is not active");
                    if (a.balance - amt < minBal(a))
                        throw new ApiError(400, "Insufficient balance. Minimum balance of " + RS + (int) minBal(a) + " must be maintained for a " + a.type + " account.");
                    a.balance = Math.round((a.balance - amt) * 100) / 100.0;
                    b.balance = Math.round((b.balance + amt) * 100) / 100.0;
                    String suffix = note.isEmpty() ? "" : " - " + note;
                    addTxn(a, "TRANSFER OUT", amt, "To " + b.name + " (" + b.number + ")" + suffix);
                    addTxn(b, "TRANSFER IN", amt, "From " + a.name + " (" + a.number + ")" + suffix);
                    save();
                    return accJ(a);
                }
                case "/api/card": {
                    Account a = user(s);
                    return "{\"number\":" + q(String.format("%016d", 4000000000000000L + Long.parseLong(a.number) % 1000000000000L)) + ",\"cvv\":" + q(a.cvv)
                        + ",\"expiry\":" + q(a.expiry) + ",\"name\":" + q(a.name.toUpperCase()) + ",\"frozen\":" + a.cardFrozen + "}";
                }
                case "/api/card/toggle": {
                    Account a = user(s); a.cardFrozen = !a.cardFrozen; save();
                    return "{\"frozen\":" + a.cardFrozen + "}";
                }
                case "/api/password": {
                    Account a = user(s);
                    if (!a.hash.equals(hash(a.salt, f.getOrDefault("old", "")))) throw new ApiError(400, "Current password is wrong");
                    String np = f.getOrDefault("new", "");
                    if (np.length() < 6) throw new ApiError(400, "New password must be at least 6 characters");
                    a.salt = token(); a.hash = hash(a.salt, np); save();
                    return "{\"ok\":true}";
                }
                case "/api/fd": {
                    Account a = user(s); StringJoiner jn = new StringJoiner(",", "[", "]");
                    for (FD d : a.fds) jn.add(fdJ(d));
                    return jn.toString();
                }
                case "/api/fd/open": {
                    Account a = user(s);
                    double amt = num(f, "amount");
                    int months;
                    try { months = Integer.parseInt(f.getOrDefault("months", "")); } catch (NumberFormatException e) { throw new ApiError(400, "Choose a duration"); }
                    double rate = months == 6 ? 6.5 : months == 12 ? 7 : months == 24 ? 7.25 : months == 36 ? 7.5 : -1;
                    if (rate < 0) throw new ApiError(400, "Invalid duration");
                    if (amt < 1000) throw new ApiError(400, "Minimum FD amount is " + RS + "1000");
                    if (a.balance - amt < minBal(a)) throw new ApiError(400, "Insufficient balance for this FD");
                    FD d = new FD(); d.id = "FD" + (1000 + RND.nextInt(9000)) + a.fds.size(); d.amount = amt; d.months = months; d.rate = rate;
                    d.maturity = Math.round(amt * (1 + rate / 100 * months / 12.0) * 100) / 100.0; d.start = now(); d.startMs = System.currentTimeMillis();
                    a.fds.add(d);
                    a.balance = Math.round((a.balance - amt) * 100) / 100.0;
                    addTxn(a, "FD DEPOSIT", amt, "Fixed deposit " + d.id + " (" + months + " months @ " + rate + "%)");
                    save(); return fdJ(d);
                }
                case "/api/fd/close": {
                    Account a = user(s);
                    for (FD d : a.fds) if (d.id.equals(f.get("id")) && d.open) {
                        boolean matured = System.currentTimeMillis() - d.startMs >= d.months * 30L * 86400000L;
                        double pay = matured ? d.maturity : d.amount;
                        d.open = false;
                        a.balance = Math.round((a.balance + pay) * 100) / 100.0;
                        addTxn(a, "FD CLOSED", pay, "Fixed deposit " + d.id + (matured ? " matured" : " closed early (no interest)"));
                        save(); return "{\"credited\":" + m(pay) + ",\"matured\":" + matured + "}";
                    }
                    throw new ApiError(404, "FD not found");
                }
                case "/api/loan/apply": {
                    Account a = user(s);
                    double amt = num(f, "amount");
                    String kind = f.getOrDefault("kind", "Personal");
                    double rate = kind.equals("Home") ? 8.5 : kind.equals("Car") ? 9.5 : kind.equals("Education") ? 9 : kind.equals("Personal") ? 11 : -1;
                    if (rate < 0) throw new ApiError(400, "Invalid loan type");
                    int yrs;
                    try { yrs = Integer.parseInt(f.getOrDefault("years", "")); } catch (NumberFormatException e) { yrs = 0; }
                    if (yrs < 1 || yrs > 30) throw new ApiError(400, "Tenure must be 1 to 30 years");
                    if (amt < 10000) throw new ApiError(400, "Minimum loan amount is " + RS + "10,000");
                    Loan l = new Loan(); l.id = "LN" + (1000 + RND.nextInt(9000)) + a.loans.size(); l.kind = kind; l.amount = amt; l.rate = rate; l.months = yrs * 12;
                    double r = rate / 1200, p = Math.pow(1 + r, l.months);
                    l.emi = Math.round(amt * r * p / (p - 1) * 100) / 100.0; l.applied = now();
                    a.loans.add(l); save(); return loanJ(l, a);
                }
                case "/api/loans": {
                    Account a = user(s); StringJoiner jn = new StringJoiner(",", "[", "]");
                    for (Loan l : a.loans) jn.add(loanJ(l, a));
                    return jn.toString();
                }
                case "/api/loan/pay": {
                    Account a = user(s);
                    for (Loan l : a.loans) if (l.id.equals(f.get("id")) && l.status.equals("APPROVED")) {
                        if (a.balance - l.emi < minBal(a)) throw new ApiError(400, "Insufficient balance to pay EMI");
                        a.balance = Math.round((a.balance - l.emi) * 100) / 100.0; l.paid++;
                        if (l.paid >= l.months) l.status = "CLOSED";
                        addTxn(a, "LOAN EMI", l.emi, "EMI " + l.paid + "/" + l.months + " for " + l.id);
                        save(); return loanJ(l, a);
                    }
                    throw new ApiError(404, "Active loan not found");
                }
                case "/api/admin/loans": {
                    need(s, "admin"); StringJoiner jn = new StringJoiner(",", "[", "]");
                    for (Account a : bank.accounts.values()) for (Loan l : a.loans) jn.add(loanJ(l, a));
                    return jn.toString();
                }
                case "/api/admin/loan/decide": {
                    need(s, "admin");
                    Account a = bank.accounts.get(f.getOrDefault("account", ""));
                    if (a == null) throw new ApiError(404, "Account not found");
                    for (Loan l : a.loans) if (l.id.equals(f.get("id")) && l.status.equals("PENDING")) {
                        if ("approve".equals(f.get("action"))) {
                            l.status = "APPROVED"; a.balance = Math.round((a.balance + l.amount) * 100) / 100.0;
                            addTxn(a, "LOAN CREDIT", l.amount, l.kind + " loan " + l.id + " approved");
                        } else l.status = "REJECTED";
                        save(); return loanJ(l, a);
                    }
                    throw new ApiError(404, "Pending loan not found");
                }
                case "/api/admin/accounts": {
                    need(s, "admin");
                    StringJoiner j = new StringJoiner(",", "{\"accounts\":[", "]}");
                    for (Account a : bank.accounts.values()) j.add(accJ(a));
                    return j.toString();
                }
                case "/api/admin/history": {
                    need(s, "admin");
                    Account a = bank.accounts.get(f.getOrDefault("account", ""));
                    if (a == null) throw new ApiError(404, "Account not found");
                    List<Txn> l = new ArrayList<>(a.txns);
                    Collections.reverse(l);
                    return txnList(l);
                }
                case "/api/admin/transactions": {
                    need(s, "admin");
                    List<Txn> all = new ArrayList<>();
                    for (Account a : bank.accounts.values()) all.addAll(a.txns);
                    all.sort((x, y) -> Long.compare(y.ts, x.ts));
                    return txnList(all.subList(0, Math.min(40, all.size())));
                }
                case "/api/admin/toggle": {
                    need(s, "admin");
                    Account a = bank.accounts.get(f.getOrDefault("account", ""));
                    if (a == null) throw new ApiError(404, "Account not found");
                    a.frozen = !a.frozen;
                    save();
                    return accJ(a);
                }
                default:
                    throw new ApiError(404, "Unknown API");
            }
        }
    }

    // ---- HTTP plumbing ----
    static Map<String, String> parse(String raw) {
        Map<String, String> m = new HashMap<>();
        if (raw == null || raw.isEmpty()) return m;
        for (String p : raw.split("&")) {
            int i = p.indexOf('=');
            try {
                String k = URLDecoder.decode(i < 0 ? p : p.substring(0, i), "UTF-8");
                String v = i < 0 ? "" : URLDecoder.decode(p.substring(i + 1), "UTF-8");
                m.put(k, v);
            } catch (UnsupportedEncodingException ignored) { }
        }
        return m;
    }
    static void send(HttpExchange ex, int code, String type, byte[] body) throws IOException {
        ex.getResponseHeaders().set("Content-Type", type);
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.sendResponseHeaders(code, body.length);
        try (OutputStream o = ex.getResponseBody()) { o.write(body); }
    }
    static void json(HttpExchange ex, int code, String body) throws IOException {
        send(ex, code, "application/json; charset=utf-8", body.getBytes(StandardCharsets.UTF_8));
    }
    static void handle(HttpExchange ex) throws IOException {
        try {
            String path = ex.getRequestURI().getPath();
            if (path.startsWith("/api/")) {
                Map<String, String> f = ex.getRequestMethod().equals("POST")
                    ? parse(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8))
                    : parse(ex.getRequestURI().getRawQuery());
                String tok = ex.getRequestHeaders().getFirst("X-Token");
                json(ex, 200, route(path, f, tok == null ? null : sessions.get(tok), tok));
            } else {
                Path p = WEB.resolve(path.equals("/") ? "index.html" : path.substring(1)).normalize();
                if (!p.startsWith(WEB) || !Files.isRegularFile(p)) { send(ex, 404, "text/plain", "Not found".getBytes()); return; }
                String n = p.getFileName().toString();
                String type = n.endsWith(".html") ? "text/html; charset=utf-8" : n.endsWith(".css") ? "text/css; charset=utf-8"
                    : n.endsWith(".js") ? "application/javascript; charset=utf-8" : "application/octet-stream";
                send(ex, 200, type, Files.readAllBytes(p));
            }
        } catch (ApiError e) {
            json(ex, e.code, "{\"error\":" + q(e.getMessage()) + "}");
        } catch (Exception e) {
            e.printStackTrace();
            json(ex, 500, "{\"error\":\"Server error\"}");
        }
    }

    public static void main(String[] args) throws Exception {
        Files.createDirectories(DATA.getParent());
        if (!Files.isDirectory(WEB)) { System.out.println("Run from the project root folder (the one containing 'web')."); return; }
        HttpServer server = HttpServer.create(new InetSocketAddress("localhost", PORT), 0);
        server.createContext("/", ThakurBank::handle);
        server.setExecutor(Executors.newFixedThreadPool(8));
        server.start();
        System.out.println("Thakur Bank is running -> http://localhost:" + PORT);
        System.out.println("Admins: admin1..admin5  (see ADMINS in ThakurBank.java for passwords)");
    }
}
