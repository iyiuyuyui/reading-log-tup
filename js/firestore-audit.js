/**
 * Firestore Read Audit Utility (Temporary Debug Layer)
 */

const DEBUG_FIRESTORE = true;

if (DEBUG_FIRESTORE) {
    console.warn("⚠️ [FIRESTORE AUDIT] Debug layer is ENABLED. Tracking read metrics...");

    window.firestoreAuditMetrics = {
        getDocCalls: 0,
        getDocsCalls: 0,
        snapshotRegistrations: 0,
        snapshotCallbacks: 0,
        dashboardReads: 0,
        dashboardStatisticsReads: 0,
        trendReads: 0
    };

    function auditPath(path) {
        if (!path || typeof path !== 'string') return;
        if (path.includes('system_stats/dashboard')) {
            window.firestoreAuditMetrics.dashboardReads++;
            console.log(`[FIREBASE_READ] system_stats/dashboard read count: ${window.firestoreAuditMetrics.dashboardReads}`);
        } else if (path.includes('dashboard_statistics')) {
            window.firestoreAuditMetrics.dashboardStatisticsReads++;
            console.log(`[FIREBASE_READ] dashboard_statistics read count: ${window.firestoreAuditMetrics.dashboardStatisticsReads} (Path: ${path})`);
        } else if (path.includes('weekly_reading_trends')) {
            window.firestoreAuditMetrics.trendReads++;
            console.log(`[FIREBASE_READ] weekly_reading_trends read count: ${window.firestoreAuditMetrics.trendReads} (Path: ${path})`);
        }
    }

    function checkQueryStr(str) {
        if (!str || typeof str !== 'string') return;
        if (str.includes('dashboard_statistics')) {
            window.firestoreAuditMetrics.dashboardStatisticsReads++;
            console.log(`[FIREBASE_READ] dashboard_statistics query read count: ${window.firestoreAuditMetrics.dashboardStatisticsReads}`);
        } else if (str.includes('weekly_reading_trends')) {
            window.firestoreAuditMetrics.trendReads++;
            console.log(`[FIREBASE_READ] weekly_reading_trends query read count: ${window.firestoreAuditMetrics.trendReads}`);
        }
    }

    // Ensure firebase is defined before hooking
    const initHook = () => {
        if (typeof firebase !== 'undefined' && firebase.firestore) {
            // 1. Hook DocumentReference.get
            const origDocGet = firebase.firestore.DocumentReference.prototype.get;
            firebase.firestore.DocumentReference.prototype.get = function(...args) {
                window.firestoreAuditMetrics.getDocCalls++;
                auditPath(this.path);
                return origDocGet.apply(this, args);
            };

            // 2. Hook Query.get
            const origQueryGet = firebase.firestore.Query.prototype.get;
            firebase.firestore.Query.prototype.get = function(...args) {
                window.firestoreAuditMetrics.getDocsCalls++;
                const str = this.toString ? this.toString() : '';
                checkQueryStr(str);
                return origQueryGet.apply(this, args);
            };

            // 3. Hook DocumentReference.onSnapshot
            const origDocSnapshot = firebase.firestore.DocumentReference.prototype.onSnapshot;
            firebase.firestore.DocumentReference.prototype.onSnapshot = function(...args) {
                window.firestoreAuditMetrics.snapshotRegistrations++;
                auditPath(this.path);

                let callbackIndex = -1;
                for (let i = 0; i < args.length; i++) {
                    if (typeof args[i] === 'function') {
                        callbackIndex = i;
                        break;
                    }
                }
                if (callbackIndex !== -1) {
                    const origCallback = args[callbackIndex];
                    const refPath = this.path;
                    args[callbackIndex] = function(...cbArgs) {
                        window.firestoreAuditMetrics.snapshotCallbacks++;
                        auditPath(refPath || (cbArgs[0] && cbArgs[0].ref ? cbArgs[0].ref.path : null));
                        return origCallback.apply(this, cbArgs);
                    };
                }
                return origDocSnapshot.apply(this, args);
            };

            // 4. Hook Query.onSnapshot
            const origQuerySnapshot = firebase.firestore.Query.prototype.onSnapshot;
            firebase.firestore.Query.prototype.onSnapshot = function(...args) {
                window.firestoreAuditMetrics.snapshotRegistrations++;
                const str = this.toString ? this.toString() : '';
                checkQueryStr(str);

                let callbackIndex = -1;
                for (let i = 0; i < args.length; i++) {
                    if (typeof args[i] === 'function') {
                        callbackIndex = i;
                        break;
                    }
                }
                if (callbackIndex !== -1) {
                    const origCallback = args[callbackIndex];
                    args[callbackIndex] = function(...cbArgs) {
                        window.firestoreAuditMetrics.snapshotCallbacks++;
                        checkQueryStr(str);
                        return origCallback.apply(this, cbArgs);
                    };
                }
                return origQuerySnapshot.apply(this, args);
            };

            // 5. Reporting interval
            setInterval(() => {
                const now = new Date();
                const formattedDate = now.getFullYear() + '-' +
                    String(now.getMonth() + 1).padStart(2, '0') + '-' +
                    String(now.getDate()).padStart(2, '0') + ' ' +
                    String(now.getHours()).padStart(2, '0') + ':' +
                    String(now.getMinutes()).padStart(2, '0') + ':' +
                    String(now.getSeconds()).padStart(2, '0');

                console.log(
`========== FIRESTORE AUDIT ==========
getDoc: ${window.firestoreAuditMetrics.getDocCalls}
getDocs: ${window.firestoreAuditMetrics.getDocsCalls}
onSnapshot Registered: ${window.firestoreAuditMetrics.snapshotRegistrations}
onSnapshot Triggered: ${window.firestoreAuditMetrics.snapshotCallbacks}

system_stats/dashboard: ${window.firestoreAuditMetrics.dashboardReads}
dashboard_statistics: ${window.firestoreAuditMetrics.dashboardStatisticsReads}
weekly_reading_trends: ${window.firestoreAuditMetrics.trendReads}

Timestamp: ${formattedDate}
=====================================`);
            }, 60000);
        } else {
            // Retry if firebase isn't fully loaded yet
            setTimeout(initHook, 50);
        }
    };

    initHook();
}
