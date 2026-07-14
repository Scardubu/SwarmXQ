Database and Prisma Instructions
Migration Discipline

Schema changes must use reviewed migrations.

Do not use prisma db push as a production migration strategy.

Do not run prisma migrate reset against valuable data.

Before applying a migration:

inspect generated SQL;
identify locks and table rewrites;
assess backfill cost;
preserve backward compatibility during rolling deployment;
establish rollback or forward-fix strategy;
verify backup and recovery expectations.

Use expand-and-contract for breaking changes:

add compatible structure
deploy dual-read or dual-write behavior
backfill safely
switch reads
remove deprecated structure later

Apply production migrations through controlled CI/CD using prisma migrate deploy.

Data Integrity

Prefer database-enforced invariants:

primary keys;
foreign keys;
unique constraints;
check constraints where supported;
non-null constraints;
explicit cascade behavior.

Do not rely only on application checks for race-sensitive invariants.

Query Quality

Avoid:

unbounded findMany;
accidental full-table scans;
N+1 queries;
fetching unused columns;
transactions around network calls;
indexes without query evidence.

For performance-sensitive queries:

capture representative SQL;
inspect the query plan;
verify cardinality assumptions;
add or modify indexes deliberately;
measure write impact.
Transactions

Use transactions for operations that must commit or fail together.

Choose isolation and locking based on the actual anomaly being prevented.

Keep transactions deterministic and short.

Handle retryable serialization or deadlock errors deliberately.