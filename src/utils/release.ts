/**
 * Shared release metadata helpers for logging, telemetry, and diagnostics.
 */

export interface ReleaseMetadata {
	buildTime: string;
	commit: string;
	environment: string;
	release: string;
	version: string;
}

function normalize(value: string | undefined, fallback: string): string {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function getDefaultVersion(): string {
	return normalize(process.env.npm_package_version, "0.1.0");
}

function getDefaultCommit(): string {
	return normalize(process.env.GIT_COMMIT, "unknown");
}

function buildRelease(version: string, commit: string): string {
	if (commit === "unknown") {
		return version;
	}
	return `${version}+${commit}`;
}

export function getReleaseMetadata(): ReleaseMetadata {
	const version = normalize(process.env.APP_VERSION, getDefaultVersion());
	const commit = getDefaultCommit();
	const release = normalize(
		process.env.APP_RELEASE,
		buildRelease(version, commit),
	);

	return {
		buildTime: normalize(process.env.BUILD_TIME, "N/A"),
		commit,
		environment: normalize(
			process.env.BUILD_ENV ?? process.env.NODE_ENV,
			"unknown",
		),
		release,
		version,
	};
}
