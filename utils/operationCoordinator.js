const activeServerOperations = new Set();
let maintenanceActive = false;

function createLease(releaseFn) {
	let released = false;
	return {
		acquired: true,
		release() {
			if (released) return;
			released = true;
			releaseFn();
		},
	};
}

function tryAcquireServerOperation(serverKey) {
	const key = String(serverKey);
	if (maintenanceActive) return { acquired: false, reason: 'maintenance' };
	if (activeServerOperations.has(key)) return { acquired: false, reason: 'server' };

	activeServerOperations.add(key);
	return createLease(() => activeServerOperations.delete(key));
}

function tryAcquireMaintenanceOperation() {
	if (maintenanceActive) return { acquired: false, reason: 'maintenance' };
	if (activeServerOperations.size > 0) return { acquired: false, reason: 'server' };

	maintenanceActive = true;
	return createLease(() => { maintenanceActive = false; });
}

function getOperationState() {
	return {
		maintenanceActive,
		serverKeys: [...activeServerOperations],
	};
}

function resetOperationState() {
	maintenanceActive = false;
	activeServerOperations.clear();
}

module.exports = {
	getOperationState,
	resetOperationState,
	tryAcquireMaintenanceOperation,
	tryAcquireServerOperation,
};
