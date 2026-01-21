use chrono::Local;

fn main() {
    // Force rebuild on every build to update timestamp
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=FORCE_REBUILD");

    // Generate build timestamp
    let build_time = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    println!("cargo:rustc-env=BUILD_TIMESTAMP={}", build_time);

    tauri_build::build()
}
