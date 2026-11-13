/// Multi-threaded Rust WebAssembly SMP compute kernels executed across parallel Web Workers.

#[inline]
fn is_prime(n: u64) -> bool {
    if n < 2 {
        return false;
    }
    if n == 2 || n == 3 {
        return true;
    }
    if n % 2 == 0 || n % 3 == 0 {
        return false;
    }
    let mut i = 5u64;
    while i * i <= n {
        if n % i == 0 || n % (i + 2) == 0 {
            return false;
        }
        i += 6;
    }
    true
}

/// Counts prime numbers in `[start, end)` inside a WebAssembly worker thread.
pub fn compute_primes_range(start: u64, end: u64) -> u64 {
    let mut count = 0u64;
    let mut n = start;
    while n < end {
        if is_prime(n) {
            count += 1;
        }
        n += 1;
    }
    count
}

/// Runs a deterministic cryptographic-style mixing benchmark in Rust Wasm for `iterations`.
pub fn compute_hash_bench(core_id: u32, iterations: u32) -> u64 {
    let mut state: u64 = 0x9E37_79B9_7F4A_7C15 ^ ((core_id as u64 + 1) * 0xBF58_476D_1CE4_E5B9);
    for i in 0..iterations {
        state ^= (i as u64).wrapping_mul(0x94D0_49BB_1331_11EB);
        state = state.rotate_left(27).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        state ^= state >> 31;
    }
    state
}

/// Evaluates Mandelbrot escape iterations across a slice of rows `[y_start, y_end)` on a worker thread.
pub fn compute_mandelbrot_slice(
    y_start: u32,
    y_end: u32,
    width: u32,
    height: u32,
    max_iter: u32,
) -> u64 {
    let mut total_iters = 0u64;
    let w = width as f64;
    let h = height as f64;
    for py in y_start..y_end {
        let cy = (py as f64 / h) * 2.4 - 1.2;
        for px in 0..width {
            let cx = (px as f64 / w) * 3.2 - 2.2;
            let mut zx = 0.0f64;
            let mut zy = 0.0f64;
            let mut iter = 0u32;
            while zx * zx + zy * zy <= 4.0 && iter < max_iter {
                let tmp = zx * zx - zy * zy + cx;
                zy = 2.0 * zx * zy + cy;
                zx = tmp;
                iter += 1;
            }
            total_iters += iter as u64;
        }
    }
    total_iters
}
