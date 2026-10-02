# Thakur Bank - Bank Management System (Java)

## Run in VS Code
1. Install JDK 17+ and the "Extension Pack for Java" in VS Code.
2. Open this folder (ThakurBank) in VS Code.
3. Open a terminal in the project root and run:
   javac -encoding UTF-8 -d out src/ThakurBank.java
   java -cp out ThakurBank
   (or open src/ThakurBank.java and click "Run" above main - run from the project root)
4. Open http://localhost:8080

## Admin logins (edit in ThakurBank.java -> ADMINS)
admin1 / Thakur@101 ... admin5 / Thakur@105

Customers: Open Account -> note account number -> Login.
Rules: minimum opening deposit and minimum balance = Rs. 500.
Data is saved in data/bank.dat (delete it to reset the bank).

Account types: Savings (min balance Rs.500) and Current (min balance Rs.1000).
NOTE: after updating from an older version, delete data/bank.dat once (old accounts use the old format).

New: virtual card (freeze), fixed deposits, loans (admin approval), EMI calculator, change password, 3-attempt login lockout, auto-logout.
After updating, delete data/bank.dat once.
