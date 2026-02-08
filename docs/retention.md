# Data Retention & Maintenance 🧹

Xenon includes an enterprise-grade cleanup system designed to manage your infrastructure's storage automatically. As your device lab runs thousands of tests, the database and disk (videos/screenshots) can grow rapidly. This system ensures Xenon stays performant and your disks don't fill up.

## How it works

The cleanup system works like a scheduled maintenance crew. It consists of three layers: **Orchestration**, **Decision Logic**, and **Scope**.

### 1. Orchestration (The Trigger)
The **Cleanup Schedule** (configured via Cron) determines **when** the maintenance job runs. 
By default, this is set to `0 0 * * *` (Daily at midnight). 

When the specified time arrives, the cleanup engine "wakes up" and scans all builds and sessions in your registry.

### 2. Retention Policies (The Decision Logic)
Xenon uses two primary rules to decide which data is "garbage." These rules use **OR logic**—a build is marked for deletion if it violates **either** of these limits.

#### **A. Retention Window (Age-based)**
- **Rule**: If a build is older than `N` days, delete it.
- **Purpose**: Ensures that stale data from previous months doesn't stay in the system forever.

#### **B. Build Capacity (Count-based)**
- **Rule**: If the total number of builds exceeds `M`, delete the oldest ones until the count is back within the limit.
- **Purpose**: Protects the server during high-volume periods (e.g., a release week) where you might generate more data in 2 days than you usually do in 30.

### 3. Asset Purge (The Scope)
The **Asset Purge** toggle determines how thorough the deletion is.

- **ENABLED (Recommended)**: When a build is deleted from the database, Xenon also finds and deletes the physical files on the server's disk (MP4 videos, PNG screenshots). This is the primary way to reclaim disk space.
- **DISABLED**: Only the database records are removed. The files remain on the disk. This is only useful if you are using an external process to archive these files.

---

## Configuration Example

You can configure these parameters in your `xenon-config.yaml`:

```yaml
plugin:
  xenon:
    # Trigger: Run every day at 1 AM
    buildCleanupSchedule: "0 1 * * *"
    
    # Policy A: Keep data for 14 days
    buildCleanupDays: 14
    
    # Policy B: Keep at most 50 builds
    buildCleanupMaxCount: 50
    
    # Scope: Clean up physical files too
    deleteBuildAssets: true
```

## Best Practices

1.  **Lower counts for local labs**: If you are running Xenon on a developer laptop, keep `buildCleanupMaxCount` low (e.g., 20) to avoid eating up personal disk space.
2.  **Higher counts for CI clusters**: In a dedicated CI environment with large attached storage, you can increase these values to maintain a longer history for audit purposes.
3.  **Schedule for quiet hours**: Run the cleanup job during off-peak hours (like 2:00 AM) to ensure it doesn't compete for resources during active test execution.
