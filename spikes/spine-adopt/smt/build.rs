//! Link shim for the BINDING arm.
//!
//! OBLIGATIONS.md § Binding notes: build against the PINNED Z3 5.1.0 release
//! libs, "avoiding a from-source cmake build". Two mechanics are needed:
//!
//!   1. `Z3_SYS_Z3_HEADER` points z3-sys' bindgen at the pinned `z3.h`. That is
//!      set by the harness/env, not here.
//!   2. z3-sys names the import library on the link line; MEASURED against
//!      z3-sys 0.11.0 (what `z3 0.20.2` resolves to — see Cargo.lock), it asks
//!      for `libz3.lib` (an earlier reading of `z3.lib`
//!      produced `LNK1181: cannot open input file 'libz3.lib'`). Both spellings
//!      are staged into `$OUT_DIR`, which is added to the link search path, so
//!      the build is robust to either convention and the pinned tools tree —
//!      checksum-pinned in toolchain.lock — is never mutated.
//!
//! Runtime still needs `libz3.dll` on PATH; the harness adds the pinned bin dir.

fn main() {
    println!("cargo:rerun-if-env-changed=SPIKE_Z3_ROOT");

    // Only the binding-z3 feature needs the native link.
    if std::env::var_os("CARGO_FEATURE_BINDING_Z3").is_none() {
        return;
    }

    let root = match std::env::var("SPIKE_Z3_ROOT") {
        Ok(value) => value,
        Err(_) => {
            println!(
                "cargo:warning=SPIKE_Z3_ROOT unset; falling back to the linker's default search \
                 path for z3. Set it to the pinned tools/z3-5.1.0-x64-win directory."
            );
            return;
        }
    };

    // On a Unix target the pinned Linux release (`z3-5.1.0-x64-glibc-2.39.zip`,
    // toolchain.lock [z3.linux]) already ships `bin/libz3.so` under the exact
    // name `-lz3` looks for, so no staging is needed: point the linker at the
    // directory and stop. (`CARGO_CFG_TARGET_OS` is the TARGET os — `cfg!()` in a
    // build script would describe the host.) The loader still needs that dir on
    // `LD_LIBRARY_PATH` at run time; the harness/CI sets it, as it does PATH on
    // Windows.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "windows" {
        let lib_dir = format!("{root}/bin");
        if std::path::Path::new(&format!("{lib_dir}/libz3.so")).exists() {
            println!("cargo:rustc-link-search=native={lib_dir}");
            println!("cargo:rerun-if-changed={lib_dir}/libz3.so");
        } else {
            println!(
                "cargo:warning=no libz3.so under {lib_dir}; the binding arm will fail to link and \
                 that is recorded as the binding-maturity finding."
            );
        }
        return;
    }

    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR is always set by cargo");
    let import_lib = format!("{root}/bin/libz3.lib");

    let mut staged_any = false;
    for name in ["libz3.lib", "z3.lib"] {
        match std::fs::copy(&import_lib, format!("{out_dir}/{name}")) {
            Ok(_) => staged_any = true,
            Err(err) => println!("cargo:warning=could not stage {import_lib} as {name}: {err}"),
        }
    }

    if staged_any {
        println!("cargo:rustc-link-search=native={out_dir}");
        println!("cargo:rerun-if-changed={import_lib}");
    } else {
        println!(
            "cargo:warning=no import library staged from {import_lib}; the binding arm will fail \
             to link and that is recorded as the binding-maturity finding."
        );
    }
}
