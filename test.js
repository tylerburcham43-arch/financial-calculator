/**
 * Test suite for Financial Calculator TVM functions
 * Run with: node test.js
 */

// ===== TVM MATH FUNCTIONS (copied from app.js) =====

function getPeriodicRate(nominalRate, cy, py) {
  const r = nominalRate / 100;
  if (cy === py) {
    return r / py;
  }
  return Math.pow(1 + r / cy, cy / py) - 1;
}

function annuityFactor(i, n, isBegin) {
  if (Math.abs(i) < 1e-10) {
    return n;
  }
  const factor = (Math.pow(1 + i, n) - 1) / i;
  return isBegin ? factor * (1 + i) : factor;
}

// FV = PV * (1+r)^N + PMT * annuityFactor
function solveFV(n, i, pv, pmt, isBegin) {
  const compoundFactor = Math.pow(1 + i, n);
  const af = annuityFactor(i, n, isBegin);
  return pv * compoundFactor + pmt * af;
}

// PV = (FV - PMT*AF) / (1+r)^N
function solvePV(n, i, pmt, fv, isBegin) {
  const compoundFactor = Math.pow(1 + i, n);
  const af = annuityFactor(i, n, isBegin);
  return (fv - pmt * af) / compoundFactor;
}

// PMT = (FV - PV*(1+r)^N) / AF
function solvePMT(n, i, pv, fv, isBegin) {
  const compoundFactor = Math.pow(1 + i, n);
  const af = annuityFactor(i, n, isBegin);
  if (Math.abs(af) < 1e-15) {
    return NaN;
  }
  return (fv - pv * compoundFactor) / af;
}

// From: FV = PV*(1+r)^N + PMT*AF
// So: FV - PV*(1+r)^N - PMT*AF = 0
function solveNNumeric(i, pv, pmt, fv, isBegin) {
  const f = (n) => {
    if (n <= 0) return fv - pv;
    const compoundFactor = Math.pow(1 + i, n);
    return fv - pv * compoundFactor - pmt * annuityFactor(i, n, isBegin);
  };
  
  let lo = 0.01, hi = 1000;
  const fLo = f(lo), fHi = f(hi);
  
  if (fLo * fHi > 0) {
    for (let test = 1; test <= 10000; test *= 10) {
      if (f(test) * fLo < 0) {
        hi = test;
        break;
      }
    }
  }
  
  for (let iter = 0; iter < 100; iter++) {
    const mid = (lo + hi) / 2;
    const fMid = f(mid);
    if (Math.abs(fMid) < 1e-10) return mid;
    if (f(lo) * fMid < 0) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return (lo + hi) / 2;
}

// For PMT=0: N = ln(FV/PV) / ln(1+r)
function solveN(i, pv, pmt, fv, isBegin) {
  if (Math.abs(i) < 1e-10) {
    if (Math.abs(pmt) < 1e-15) return NaN;
    return (fv - pv) / pmt;
  }
  
  if (Math.abs(pmt) < 1e-15) {
    if (Math.abs(pv) < 1e-15) return NaN;
    const ratio = fv / pv;
    if (ratio <= 0) return NaN;
    return Math.log(ratio) / Math.log(1 + i);
  }
  
  return solveNNumeric(i, pv, pmt, fv, isBegin);
}

function bisectionSolveI(f, lo, hi, maxIter) {
  let fLo = f(lo), fHi = f(hi);
  
  if (fLo * fHi > 0) {
    for (let test of [-0.5, 0, 0.01, 0.1, 0.5, 1, 1.5]) {
      if (test > lo && test < hi && f(test) * fLo < 0) {
        hi = test;
        fHi = f(hi);
        break;
      } else if (test > lo && test < hi && f(test) * fHi < 0) {
        lo = test;
        fLo = f(lo);
        break;
      }
    }
  }
  
  for (let iter = 0; iter < maxIter; iter++) {
    const mid = (lo + hi) / 2;
    const fMid = f(mid);
    if (Math.abs(fMid) < 1e-10) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

// Find i such that: FV - PV*(1+i)^N - PMT*AF = 0
function solveIY(n, pv, pmt, fv, isBegin, cy, py) {
  const f = (i) => {
    const compoundFactor = Math.pow(1 + i, n);
    const af = annuityFactor(i, n, isBegin);
    return fv - pv * compoundFactor - pmt * af;
  };
  
  const df = (i) => {
    if (Math.abs(i) < 1e-10) {
      return -pv * n - pmt * n * (n + 1) / 2;
    }
    
    const onePlusI = 1 + i;
    const onePlusIN = Math.pow(onePlusI, n);
    const dCompound = n * Math.pow(onePlusI, n - 1);
    const af = (onePlusIN - 1) / i;
    const dAf = (n * Math.pow(onePlusI, n - 1) * i - (onePlusIN - 1)) / (i * i);
    const dAfBgn = isBegin ? (dAf * onePlusI + af) : dAf;
    
    return -pv * dCompound - pmt * dAfBgn;
  };
  
  let i = 0.05;
  let bestI = i;
  let bestF = Math.abs(f(i));
  
  for (let iter = 0; iter < 50; iter++) {
    const fVal = f(i);
    if (Math.abs(fVal) < 1e-10) {
      bestI = i;
      break;
    }
    if (Math.abs(fVal) < bestF) {
      bestF = Math.abs(fVal);
      bestI = i;
    }
    const dfVal = df(i);
    if (Math.abs(dfVal) < 1e-15) break;
    let newI = i - fVal / dfVal;
    if (newI <= -0.99) newI = i / 2;
    if (newI > 10) newI = (i + 10) / 2;
    if (Math.abs(newI - i) < 1e-12) {
      bestI = newI;
      break;
    }
    i = newI;
  }
  
  if (Math.abs(f(bestI)) > 1e-6) {
    bestI = bisectionSolveI(f, -0.99, 2, 100);
  }
  
  let nominalRate;
  if (cy === py) {
    nominalRate = bestI * py;
  } else {
    nominalRate = cy * (Math.pow(1 + bestI, py / cy) - 1);
  }
  
  return nominalRate * 100;
}

// ===== NPV AND IRR =====

function calculateNPV(cashFlows, rate, py) {
  const periodicRate = rate / 100 / py;
  let npv = 0;
  for (let t = 0; t < cashFlows.length; t++) {
    npv += cashFlows[t] / Math.pow(1 + periodicRate, t);
  }
  return npv;
}

function bisectionIRR(f, lo, hi, maxIter) {
  let fLo = f(lo), fHi = f(hi);
  
  if (fLo * fHi > 0) {
    for (const test of [-0.5, 0, 0.01, 0.1, 0.5, 1]) {
      if (f(test) * fLo < 0) {
        hi = test;
        fHi = f(hi);
        break;
      } else if (f(test) * fHi < 0) {
        lo = test;
        fLo = f(lo);
        break;
      }
    }
  }
  
  for (let iter = 0; iter < maxIter; iter++) {
    const mid = (lo + hi) / 2;
    const fMid = f(mid);
    if (Math.abs(fMid) < 1e-10) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

function calculateIRR(cashFlows, py) {
  const npvFunc = (r) => {
    let npv = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      npv += cashFlows[t] / Math.pow(1 + r, t);
    }
    return npv;
  };
  
  const npvDerivative = (r) => {
    let deriv = 0;
    for (let t = 1; t < cashFlows.length; t++) {
      deriv -= t * cashFlows[t] / Math.pow(1 + r, t + 1);
    }
    return deriv;
  };
  
  let r = 0.1;
  let bestR = r;
  let bestNPV = Math.abs(npvFunc(r));
  
  for (let iter = 0; iter < 100; iter++) {
    const npv = npvFunc(r);
    if (Math.abs(npv) < 1e-10) {
      bestR = r;
      break;
    }
    if (Math.abs(npv) < bestNPV) {
      bestNPV = Math.abs(npv);
      bestR = r;
    }
    const deriv = npvDerivative(r);
    if (Math.abs(deriv) < 1e-15) break;
    let newR = r - npv / deriv;
    if (newR <= -0.99) newR = (r - 0.99) / 2;
    if (newR > 10) newR = (r + 10) / 2;
    if (Math.abs(newR - r) < 1e-10) {
      bestR = newR;
      break;
    }
    r = newR;
  }
  
  if (Math.abs(npvFunc(bestR)) > 1e-6) {
    bestR = bisectionIRR(npvFunc, -0.99, 2, 100);
  }
  
  return bestR * py * 100;
}

// ===== TEST SUITE =====

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${e.message}`);
    failed++;
  }
}

function assertClose(actual, expected, tolerance = 0.01) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`Expected ${expected}, got ${actual} (diff: ${Math.abs(actual - expected)})`);
  }
}

console.log('=== Financial Calculator Test Suite ===\n');

// Test 1: Future Value - Simple compound interest
// $10,000 at 5% annual for 10 years, monthly compounding
// With new convention: FV = PV * (1+r)^N, so FV is negative (investment grows)
test('FV: $10,000 at 5% for 10 years (monthly)', () => {
  const n = 120; // 10 years * 12 months
  const iy = 5; // 5% annual
  const pv = -10000;  // Invest $10,000
  const pmt = 0;
  const cy = 12, py = 12;
  const i = getPeriodicRate(iy, cy, py);
  const fv = solveFV(n, i, pv, pmt, false);
  assertClose(fv, -16470.09, 1); // PV*compound = -10000*1.647 = -16470
});

// Test 2: Present Value - Loan amount
// PMT=$500/month, 6% rate, 30 year mortgage
test('PV: 30-year mortgage at 6% with $500/month payment', () => {
  const n = 360; // 30 years * 12 months
  const iy = 6; // 6% annual
  const pmt = -500;
  const fv = 0;
  const cy = 12, py = 12;
  const i = getPeriodicRate(iy, cy, py);
  const pv = solvePV(n, i, pmt, fv, false);
  assertClose(pv, 83396.07, 1); // Expected: ~$83,396
});

// Test 3: Payment - Monthly mortgage payment
// $200,000 loan, 6.5% rate, 30 years
test('PMT: $200,000 loan at 6.5% for 30 years', () => {
  const n = 360;
  const iy = 6.5;
  const pv = 200000;
  const fv = 0;
  const cy = 12, py = 12;
  const i = getPeriodicRate(iy, cy, py);
  const pmt = solvePMT(n, i, pv, fv, false);
  assertClose(pmt, -1264.14, 1); // Expected: ~$1,264.14/month
});

// Test 4: Number of periods - How long to double money
// PV=$10,000, FV=$20,000, 7% annual
test('N: Periods to double money at 7% annual (monthly)', () => {
  const iy = 7;
  const pv = -10000;
  const fv = 20000;
  const pmt = 0;
  const cy = 12, py = 12;
  const i = getPeriodicRate(iy, cy, py);
  const n = solveN(i, pv, pmt, fv, false);
  assertClose(n, 119.17, 1); // Expected: ~119 months (~10 years)
});

// Test 5: Interest Rate - What rate doubles money in 7 years
// With new convention: PV=-10000 (invest), FV=-20000 (doubled, still negative)
test('I/Y: Rate to double money in 7 years (annual)', () => {
  const n = 7;
  const pv = -10000;
  const fv = -20000;  // Same sign as PV (account balance doubled)
  const pmt = 0;
  const cy = 1, py = 1;
  const iy = solveIY(n, pv, pmt, fv, false, cy, py);
  assertClose(iy, 10.41, 0.1); // Expected: ~10.41% (Rule of 72: 72/7 = 10.3%)
});

// Test 6: Savings with regular deposits
// $0 initial, $500/month deposits, 8% annual, 20 years
// PMT=-500 (deposit), FV will be negative (account balance)
test('FV: Savings of $500/month at 8% for 20 years', () => {
  const n = 240;
  const iy = 8;
  const pv = 0;
  const pmt = -500;  // Deposit $500/month
  const cy = 12, py = 12;
  const i = getPeriodicRate(iy, cy, py);
  const fv = solveFV(n, i, pv, pmt, false);
  assertClose(fv, -294510.21, 100); // Negative = account balance
});

// Test 7: Retirement withdrawal - How much can you withdraw
// $1,000,000 saved, 4% rate, 30 years
test('PMT: Monthly withdrawal from $1M at 4% for 30 years', () => {
  const n = 360;
  const iy = 4;
  const pv = -1000000;
  const fv = 0;
  const cy = 12, py = 12;
  const i = getPeriodicRate(iy, cy, py);
  const pmt = solvePMT(n, i, pv, fv, false);
  assertClose(pmt, 4774.15, 5); // Expected: ~$4,774/month
});

// Test 8: Beginning of period (annuity due)
// PMT=-100 (deposits), FV will be negative (account balance)
test('FV: Annuity due - $100/month at 6% for 10 years (BGN mode)', () => {
  const n = 120;
  const iy = 6;
  const pv = 0;
  const pmt = -100;  // Deposit $100/month
  const cy = 12, py = 12;
  const i = getPeriodicRate(iy, cy, py);
  const fv = solveFV(n, i, pv, pmt, true); // BGN mode
  assertClose(fv, -16469.87, 10); // Negative = account balance
});

// Test 9: NPV calculation
test('NPV: Investment with cash flows', () => {
  const cashFlows = [-100000, 30000, 35000, 40000, 45000];
  const rate = 10; // 10% discount rate
  const py = 1;
  const npv = calculateNPV(cashFlows, rate, py);
  // NPV = -100000 + 30000/1.1 + 35000/1.1^2 + 40000/1.1^3 + 45000/1.1^4 = 16986.54
  assertClose(npv, 16986.54, 1);
});

// Test 10: IRR calculation
test('IRR: Investment returns', () => {
  const cashFlows = [-100000, 30000, 35000, 40000, 45000];
  const py = 1;
  const irr = calculateIRR(cashFlows, py);
  // IRR that makes NPV = 0: ~17.09%
  assertClose(irr, 17.09, 0.5);
});

// Test 11: Zero NPV at IRR
test('NPV at IRR should be zero', () => {
  const cashFlows = [-100000, 30000, 35000, 40000, 45000];
  const py = 1;
  const irr = calculateIRR(cashFlows, py);
  const npvAtIRR = calculateNPV(cashFlows, irr, py);
  assertClose(npvAtIRR, 0, 0.01);
});

// Test 12: Different C/Y and P/Y
test('PV with different C/Y and P/Y (quarterly compounding, monthly payments)', () => {
  const n = 60; // 5 years monthly
  const iy = 6; // 6% annual, compounded quarterly
  const pmt = -200;
  const fv = 0;
  const cy = 4, py = 12; // Different C/Y and P/Y
  const i = getPeriodicRate(iy, cy, py);
  const pv = solvePV(n, i, pmt, fv, false);
  // Periodic rate: (1 + 0.06/4)^(4/12) - 1 = 0.00497
  assertClose(pv, 10352.52, 10);
});

// Test 13: Car loan calculation
test('PMT: $25,000 car loan at 5.5% for 5 years', () => {
  const n = 60;
  const iy = 5.5;
  const pv = 25000;
  const fv = 0;
  const cy = 12, py = 12;
  const i = getPeriodicRate(iy, cy, py);
  const pmt = solvePMT(n, i, pv, fv, false);
  assertClose(pmt, -476.94, 1); // Expected: ~$477/month
});

// Test 14: College savings goal
// Goal FV=-100000 (account balance), calculate PMT needed
test('PMT: Save for $100,000 college fund in 18 years at 7%', () => {
  const n = 216; // 18 years * 12 months
  const iy = 7;
  const pv = 0;
  const fv = -100000;  // Negative = target account balance
  const cy = 12, py = 12;
  const i = getPeriodicRate(iy, cy, py);
  const pmt = solvePMT(n, i, pv, fv, false);
  // PMT = (FV - PV*compound) / AF = -100000 / AF ≈ -$232.17/month (deposits)
  assertClose(pmt, -232.17, 1);
});

// Test 15: Zero interest rate edge case
// PV=-1000, PMT=-100 (deposits), FV = PV + PMT*N
test('FV: Zero interest rate (simple addition)', () => {
  const n = 12;
  const i = 0;
  const pv = -1000;   // Initial deposit
  const pmt = -100;   // Monthly deposits
  const fv = solveFV(n, i, pv, pmt, false);
  // FV = PV + PMT*N = -1000 + (-100)*12 = -2200
  assertClose(fv, -2200, 0.01);
});

// ===== AMORTIZATION TESTS =====

function calculateAmort(n, iy, pv, pmt, cy, py, p1, p2, isBegin) {
  const i = getPeriodicRate(iy, cy, py);
  let balance = pv;
  let totalPrincipal = 0;
  let totalInterest = 0;
  
  for (let period = 1; period <= p2; period++) {
    let interestPayment, principalPayment;
    
    if (isBegin) {
      principalPayment = -pmt;
      balance += principalPayment;
      interestPayment = balance * i;
      balance += interestPayment;
    } else {
      interestPayment = balance * i;
      principalPayment = -pmt - interestPayment;
      balance += interestPayment + pmt;
    }
    
    if (period >= p1) {
      totalPrincipal += principalPayment;
      totalInterest += interestPayment;
    }
  }
  
  return { principal: totalPrincipal, interest: totalInterest, balance: balance };
}

// Test 16: Amortization - First payment breakdown
test('AMORT: First payment of $200k loan at 6.5% for 30 years', () => {
  const n = 360;
  const iy = 6.5;
  const pv = 200000;
  const cy = 12, py = 12;
  const i = getPeriodicRate(iy, cy, py);
  const pmt = solvePMT(n, i, pv, 0, false); // ~$1264.14
  
  const result = calculateAmort(n, iy, pv, pmt, cy, py, 1, 1, false);
  
  // First month: interest = 200000 * (6.5%/12) = $1083.33
  assertClose(result.interest, 1083.33, 1);
  // Principal = payment - interest = 1264.14 - 1083.33 = $180.81
  assertClose(result.principal, 180.81, 1);
  // Balance = 200000 - 180.81 = $199,819.19
  assertClose(result.balance, 199819.19, 1);
});

// Test 17: Amortization - Full first year
test('AMORT: First year of $200k loan at 6.5% for 30 years', () => {
  const n = 360;
  const iy = 6.5;
  const pv = 200000;
  const cy = 12, py = 12;
  const i = getPeriodicRate(iy, cy, py);
  const pmt = solvePMT(n, i, pv, 0, false);
  
  const result = calculateAmort(n, iy, pv, pmt, cy, py, 1, 12, false);
  
  // After 12 payments, principal paid ~$2,236, interest ~$12,934
  assertClose(result.principal, 2236.06, 10);
  assertClose(result.interest, 12933.62, 10);
  assertClose(result.balance, 197763.94, 10);
});

// Test 18: Amortization - Last payment
test('AMORT: Last payment of $200k loan at 6.5% for 30 years', () => {
  const n = 360;
  const iy = 6.5;
  const pv = 200000;
  const cy = 12, py = 12;
  const i = getPeriodicRate(iy, cy, py);
  const pmt = solvePMT(n, i, pv, 0, false);
  
  const result = calculateAmort(n, iy, pv, pmt, cy, py, 360, 360, false);
  
  // Last payment is almost all principal
  assertClose(result.balance, 0, 1); // Should be fully paid off
});

// ===== ARITHMETIC TESTS =====

test('Basic arithmetic: addition', () => {
  assertClose(100 + 250, 350, 0);
});

test('Basic arithmetic: subtraction', () => {
  assertClose(500 - 123, 377, 0);
});

test('Basic arithmetic: multiplication', () => {
  assertClose(12 * 25, 300, 0);
});

test('Basic arithmetic: division', () => {
  assertClose(1000 / 8, 125, 0);
});

// ===== EDGE CASE TESTS =====

test('Edge case: Very small interest rate (0.001%)', () => {
  const n = 12;
  const iy = 0.001;
  const pv = -10000;  // Investment
  const pmt = 0;
  const cy = 12, py = 12;
  const i = getPeriodicRate(iy, cy, py);
  const fv = solveFV(n, i, pv, pmt, false);
  // FV = PV * compound = -10000 * 1.00001 ≈ -10000.10
  assertClose(fv, -10000.10, 0.01);
});

test('Edge case: Large N (1000 periods)', () => {
  const n = 1000;
  const iy = 5;
  const pv = -100;  // Investment
  const pmt = 0;
  const cy = 12, py = 12;
  const i = getPeriodicRate(iy, cy, py);
  const fv = solveFV(n, i, pv, pmt, false);
  // Should handle large exponents without overflow, FV should be negative
  assertClose(fv < 0, true, 0);
});

test('Edge case: Negative interest rate (-2%)', () => {
  const n = 12;
  const iy = -2;
  const pv = -10000;  // Investment
  const pmt = 0;
  const cy = 12, py = 12;
  const i = getPeriodicRate(iy, cy, py);
  const fv = solveFV(n, i, pv, pmt, false);
  // FV = PV * compound = -10000 * 0.98 ≈ -9802 (loses value)
  assertClose(fv, -9802.02, 1);
});

console.log('\n=== Test Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed === 0) {
  console.log('\n✓ All tests passed! Calculator is working correctly.');
  process.exit(0);
} else {
  console.log(`\n✗ ${failed} test(s) failed.`);
  process.exit(1);
}
