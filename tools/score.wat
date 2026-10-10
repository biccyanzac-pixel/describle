;; Int8 dot products with WASM SIMD (Safari 16.4+, Chrome 91+, Firefox 89+).
;; score(q, m, n, d, out): for each of n rows of d int8 values at m, out[i] = sum_j q[j] * m[i*d + j] (int32).
;; q is d int16 values (the query, pre-quantised by the caller). d must be a multiple of 16.
;; Build: node tools/build-wasm.mjs  ->  site/js/score.wasm.js (bytes inlined as base64)
(module
  (memory (export "mem") 1)
  (func (export "score") (param $q i32) (param $m i32) (param $n i32) (param $d i32) (param $out i32)
    (local $i i32) (local $j i32) (local $row i32) (local $acc v128) (local $v v128)
    (local.set $row (local.get $m))
    (block $done
      (loop $rows
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $acc (v128.const i32x4 0 0 0 0))
        (local.set $j (i32.const 0))
        (loop $cols
          (local.set $v (v128.load (i32.add (local.get $row) (local.get $j))))
          (local.set $acc (i32x4.add (local.get $acc)
            (i32x4.dot_i16x8_s (i16x8.extend_low_i8x16_s (local.get $v))
                               (v128.load (i32.add (local.get $q) (i32.shl (local.get $j) (i32.const 1)))))))
          (local.set $acc (i32x4.add (local.get $acc)
            (i32x4.dot_i16x8_s (i16x8.extend_high_i8x16_s (local.get $v))
                               (v128.load offset=16 (i32.add (local.get $q) (i32.shl (local.get $j) (i32.const 1)))))))
          (local.set $j (i32.add (local.get $j) (i32.const 16)))
          (br_if $cols (i32.lt_u (local.get $j) (local.get $d))))
        (i32.store (i32.add (local.get $out) (i32.shl (local.get $i) (i32.const 2)))
          (i32.add (i32.add (i32x4.extract_lane 0 (local.get $acc)) (i32x4.extract_lane 1 (local.get $acc)))
                   (i32.add (i32x4.extract_lane 2 (local.get $acc)) (i32x4.extract_lane 3 (local.get $acc)))))
        (local.set $row (i32.add (local.get $row) (local.get $d)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $rows)))
  )
)
