/**
 * Financial Calculator - Time Value of Money
 * Implements standard TVM calculations with proper compounding
 */
console.log("ENTER FIX VERSION = v3");

// Disable service worker to prevent caching issues on GitHub Pages
const ENABLE_SW = false;

(function() {
  'use strict';

  // ===== STATE =====
  const state = {
    // TVM variables (null = not set)
    N: null,
    IY: null,
    PV: null,
    PMT: null,
    FV: null,
    
    // Settings (single source of truth)
    // Start at 0 (unset) - user must set before computing
    py: 0,   // Payment periods per year (0 = unset)
    cy: 0,   // Compounding periods per year (0 = unset)
    BGN: false, // true = beginning of period, false = end
    
    // Entry state
    entry: '0',
    isNewEntry: true,
    selectedVar: null,
    
    // Memory
    memory: 0,
    lastComputed: null,
    lastComputedVar: null,
    
    // Clear state (for double-press C/CE)
    lastClearTime: 0,
    
    // RCL mode
    rclMode: false,
    
    // CPT armed mode (waiting for user to press a variable to compute)
    computeArmed: false,
    
    // Arithmetic
    operator: null,
    operand: null,
    
    // Mode: 'tvm', 'cf', or 'amort'
    mode: 'tvm',
    
    // Cash flow state
    cashFlows: [0],  // CF0, CF1, CF2, etc.
    cfIndex: 0,      // Currently selected cash flow
    cfDiscountRate: null,  // I/Y for NPV calculation
    
    // Amortization state
    amortP1: 1,      // Start period
    amortP2: 1,      // End period
    amortResults: null,  // Calculated results
  };

  // ===== DOM ELEMENTS =====
  const elements = {
    displayN: document.getElementById('display-N'),
    displayIY: document.getElementById('display-IY'),
    displayPV: document.getElementById('display-PV'),
    displayPMT: document.getElementById('display-PMT'),
    displayFV: document.getElementById('display-FV'),
    displayCY: document.getElementById('display-CY'),
    displayPY: document.getElementById('display-PY'),
    displayBGN: document.getElementById('display-BGN'),
    entryValue: document.getElementById('entry-value'),
    entryLabel: document.getElementById('entry-label'),
    messageArea: document.getElementById('message-area'),
    tvmRows: document.querySelectorAll('.tvm-row'),
    
    // Mode panels
    tvmPanel: document.getElementById('tvm-panel'),
    cfPanel: document.getElementById('cf-panel'),
    amortPanel: document.getElementById('amort-panel'),
    
    // Cash flow elements
    cfList: document.getElementById('cf-list'),
    cfCount: document.getElementById('cf-count'),
    cfIndex: document.getElementById('cf-index'),
    
    // Amortization elements
    amortRange: document.getElementById('amort-range'),
    amortPrincipal: document.getElementById('amort-principal'),
    amortInterest: document.getElementById('amort-interest'),
    amortBalance: document.getElementById('amort-balance'),
  };

  // ===== UTILITY FUNCTIONS =====
  
  function formatNumber(num, maxDecimals = 6) {
    if (num === null || num === undefined) return '—';
    if (!isFinite(num)) return 'ERROR';
    
    // Handle very small numbers
    if (Math.abs(num) < 1e-10 && num !== 0) {
      return num.toExponential(4);
    }
    
    // Handle very large numbers
    if (Math.abs(num) >= 1e12) {
      return num.toExponential(4);
    }
    
    // Regular formatting
    const rounded = parseFloat(num.toFixed(maxDecimals));
    return rounded.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxDecimals,
    });
  }

  function showMessage(msg, type = 'info') {
    elements.messageArea.textContent = msg;
    elements.messageArea.className = 'message-area ' + type;
    
    // Clear message after delay
    setTimeout(() => {
      if (elements.messageArea.textContent === msg) {
        elements.messageArea.textContent = '';
        elements.messageArea.className = 'message-area';
      }
    }, 3000);
  }

  function clearMessage() {
    elements.messageArea.textContent = '';
    elements.messageArea.className = 'message-area';
  }

  // ===== DISPLAY UPDATE =====
  
  function updateDisplay() {
    // Update TVM values
    elements.displayN.textContent = formatNumber(state.N);
    elements.displayIY.textContent = state.IY !== null ? formatNumber(state.IY) + '%' : '—';
    elements.displayPV.textContent = formatNumber(state.PV);
    elements.displayPMT.textContent = formatNumber(state.PMT);
    elements.displayFV.textContent = formatNumber(state.FV);
    
    // Highlight computed value
    ['N', 'IY', 'PV', 'PMT', 'FV'].forEach(v => {
      const el = elements['display' + v.replace('/', '')];
      if (v === state.lastComputedVar) {
        el.classList.add('computed');
      } else {
        el.classList.remove('computed');
      }
    });
    
    // Update settings (read from state.py and state.cy)
    // Show "—" when unset (0)
    elements.displayCY.textContent = state.cy > 0 ? state.cy : '—';
    elements.displayPY.textContent = state.py > 0 ? state.py : '—';
    elements.displayBGN.textContent = state.BGN ? 'BGN' : 'END';
    
    // Update entry display
    elements.entryValue.textContent = state.entry;
    
    // Update selected row highlight
    elements.tvmRows.forEach(row => {
      if (row.dataset.var === state.selectedVar) {
        row.classList.add('selected');
      } else {
        row.classList.remove('selected');
      }
    });
    
    // Update entry label
    if (state.computeArmed) {
      elements.entryLabel.textContent = 'CPT →';
    } else if (state.rclMode) {
      elements.entryLabel.textContent = 'RCL';
    } else if (state.mode === 'cf') {
      elements.entryLabel.textContent = `CF${state.cfIndex} =`;
    } else if (state.mode === 'amort') {
      elements.entryLabel.textContent = `P${state.amortP1}-${state.amortP2}`;
    } else if (state.selectedVar) {
      const labels = {
        N: 'N =',
        IY: 'I/Y =',
        PV: 'PV =',
        PMT: 'PMT =',
        FV: 'FV =',
        CY: 'C/Y =',
        PY: 'P/Y ='
      };
      elements.entryLabel.textContent = labels[state.selectedVar] || '';
    } else {
      elements.entryLabel.textContent = '';
    }
  }

  // ===== ENTRY HANDLING =====
  
  function appendDigit(digit) {
    clearMessage();
    state.rclMode = false;
    state.computeArmed = false;
    
    if (state.isNewEntry) {
      state.entry = digit === '.' ? '0.' : digit;
      state.isNewEntry = false;
    } else {
      // Prevent multiple decimals
      if (digit === '.' && state.entry.includes('.')) return;
      // Limit length (count only digits)
      if (state.entry.replace(/[^0-9]/g, '').length >= 12) return;
      
      // If entry is just "-", handle decimal specially: "-" + "." -> "-0."
      if (state.entry === '-' && digit === '.') {
        state.entry = '-0.';
      } else {
        state.entry += digit;
      }
    }
    
    updateDisplay();
  }

  function negateEntry() {
    clearMessage();
    state.rclMode = false;
    
    // If entry buffer is empty (default state), start a negative number
    if (state.isNewEntry && state.entry === '0') {
      state.entry = '-';
      state.isNewEntry = false;
      updateDisplay();
      return;
    }
    
    // If entry is just "-", toggle back to positive (empty/0)
    if (state.entry === '-') {
      state.entry = '0';
      state.isNewEntry = true;
      updateDisplay();
      return;
    }
    
    // Toggle the sign of the current entry
    if (state.entry.startsWith('-')) {
      state.entry = state.entry.substring(1);
    } else {
      state.entry = '-' + state.entry;
    }
    
    updateDisplay();
  }

  function deleteLastChar() {
    // Clear armed modes on any input action
    state.computeArmed = false;
    state.rclMode = false;
    
    // If entry buffer is empty (default state), do nothing
    if (state.isNewEntry && state.entry === '0') {
      return;
    }
    
    // If only one character (or "-X"), reset to empty state
    if (state.entry.length <= 1 || (state.entry.length === 2 && state.entry.startsWith('-'))) {
      state.entry = '0';
      state.isNewEntry = true;
    } else {
      // Remove last character
      state.entry = state.entry.slice(0, -1);
    }
    updateDisplay();
  }

  function getEntryValue() {
    return parseFloat(state.entry) || 0;
  }

  // ===== VARIABLE STORAGE =====
  
  /**
   * Store entry buffer value into a TVM register
   * Called when user types a value and then presses a TVM key
   */
  function storeVariable(varName) {
    clearMessage();
    state.rclMode = false;
    state.computeArmed = false;
    
    const value = getEntryValue();
    
    if (['N', 'IY', 'PV', 'PMT', 'FV'].includes(varName)) {
      state[varName] = value;
      state.selectedVar = varName;
      // Clear computed highlight when manually setting
      if (state.lastComputedVar === varName) {
        state.lastComputedVar = null;
      }
      
      const label = varName === 'IY' ? 'I/Y' : varName;
      showMessage(`${label} = ${formatNumber(value)}`, 'success');
      
      // Debug logging
      console.log('Stored', varName, '=', state[varName], 'entryBuffer was:', state.entry);
    }
    // Note: CY and PY are handled by handleSettingKey, not here
    
    // IMPORTANT: Clear entry buffer IMMEDIATELY after storing to prevent carryover
    state.entry = '0';
    state.isNewEntry = true;
    console.log('Entry buffer cleared: entry="0", isNewEntry=true');
    
    updateDisplay();
  }

  /**
   * Check if entry buffer has a complete value (user has typed a number)
   */
  function hasEntryValue() {
    // Entry buffer has a value if:
    // - isNewEntry is false (user has started typing) AND
    // - entry is not just "-" (incomplete negative number)
    if (state.isNewEntry) return false;
    if (state.entry === '-') return false;
    return true;
  }

  /**
   * Clear a single TVM register (set to null)
   * Called when user presses a TVM key with empty entry buffer
   */
  function clearRegister(varName) {
    clearMessage();
    state.rclMode = false;
    state.computeArmed = false;
    
    if (['N', 'IY', 'PV', 'PMT', 'FV'].includes(varName)) {
      state[varName] = null;
      state.selectedVar = varName;
      
      // Clear the computed highlight if this was the computed value
      if (state.lastComputedVar === varName) {
        state.lastComputedVar = null;
      }
      
      const label = varName === 'IY' ? 'I/Y' : varName;
      showMessage(`${label} cleared`, 'info');
      
      // Debug logging
      console.log('Cleared', varName, 'to null, entryBuffer:', state.entry);
      
      state.entry = '0';
      state.isNewEntry = true;
      updateDisplay();
    }
  }

  // ===== TVM MATH =====
  
  /**
   * Calculate effective periodic interest rate
   * Converts nominal annual rate to rate per payment period
   */
  function getPeriodicRate(nominalRate, cy, py) {
    // nominalRate is in percent (e.g., 6 for 6%)
    const r = nominalRate / 100;
    
    // Effective periodic rate
    // i_period = (1 + r/CY)^(CY/PY) - 1
    if (cy === py) {
      return r / py;
    }
    return Math.pow(1 + r / cy, cy / py) - 1;
  }

  /**
   * TVM equation: PV + PMT * factor + FV * (1+i)^(-N) = 0
   * Where factor = [(1+i)^N - 1] / i  (adjusted for BGN mode)
   */
  
  function annuityFactor(i, n, isBegin) {
    if (Math.abs(i) < 1e-10) {
      // Zero interest rate
      return n;
    }
    
    const factor = (Math.pow(1 + i, n) - 1) / i;
    return isBegin ? factor * (1 + i) : factor;
  }

  function presentValueFactor(i, n) {
    return Math.pow(1 + i, -n);
  }

  /**
   * Solve for FV using proper compound interest formulas:
   * 
   * For lump sum (PMT=0): FV = PV * (1+r)^N
   * For annuity: FV = PV*(1+r)^N + PMT*((1+r)^N - 1)/r
   * For BGN mode: multiply annuity portion by (1+r)
   */
  function solveFV(n, i, pv, pmt, isBegin) {
    const compoundFactor = Math.pow(1 + i, n);  // (1+r)^N
    const af = annuityFactor(i, n, isBegin);
    
    // FV = PV * (1+r)^N + PMT * annuityFactor
    return pv * compoundFactor + pmt * af;
  }

  /**
   * Solve for PV
   * From: FV = PV*(1+r)^N + PMT*AF
   * PV = (FV - PMT*AF) / (1+r)^N
   */
  function solvePV(n, i, pmt, fv, isBegin) {
    const compoundFactor = Math.pow(1 + i, n);  // (1+r)^N
    const af = annuityFactor(i, n, isBegin);
    
    return (fv - pmt * af) / compoundFactor;
  }

  /**
   * Solve for PMT
   * From: FV = PV*(1+r)^N + PMT*AF
   * PMT = (FV - PV*(1+r)^N) / AF
   */
  function solvePMT(n, i, pv, fv, isBegin) {
    const compoundFactor = Math.pow(1 + i, n);  // (1+r)^N
    const af = annuityFactor(i, n, isBegin);
    
    if (Math.abs(af) < 1e-15) {
      return NaN;
    }
    
    return (fv - pv * compoundFactor) / af;
  }

  /**
   * Solve for N using logarithm when possible
   */
  /**
   * Solve for N
   * From: FV = PV*(1+r)^N + PMT*AF
   * 
   * Special case PMT=0: N = ln(FV/PV) / ln(1+r)
   */
  function solveN(i, pv, pmt, fv, isBegin) {
    if (Math.abs(i) < 1e-10) {
      // Zero interest: FV = PV + PMT*N, so N = (FV - PV) / PMT
      if (Math.abs(pmt) < 1e-15) return NaN;
      return (fv - pv) / pmt;
    }
    
    // Special case: PMT = 0 (lump sum)
    if (Math.abs(pmt) < 1e-15) {
      // FV = PV * (1+i)^N
      // (1+i)^N = FV/PV
      if (Math.abs(pv) < 1e-15) return NaN;
      const ratio = fv / pv;
      if (ratio <= 0) return NaN;
      return Math.log(ratio) / Math.log(1 + i);
    }
    
    // General case: numeric solution
    return solveNNumeric(i, pv, pmt, fv, isBegin);
  }

  function solveNNumeric(i, pv, pmt, fv, isBegin) {
    // Use bisection with reasonable bounds
    // From: FV = PV*(1+r)^N + PMT*AF
    // So: FV - PV*(1+r)^N - PMT*AF = 0
    const f = (n) => {
      if (n <= 0) return fv - pv; // Not valid
      const compoundFactor = Math.pow(1 + i, n);
      return fv - pv * compoundFactor - pmt * annuityFactor(i, n, isBegin);
    };
    
    // Find bounds
    let lo = 0.01, hi = 1000;
    const fLo = f(lo), fHi = f(hi);
    
    // Check if solution exists
    if (fLo * fHi > 0) {
      // Try to find better bounds
      for (let test = 1; test <= 10000; test *= 10) {
        if (f(test) * fLo < 0) {
          hi = test;
          break;
        }
      }
    }
    
    // Bisection
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

  /**
   * Solve for I/Y using Newton-Raphson with bisection fallback
   */
  /**
   * Solve for I/Y using Newton-Raphson
   * From: FV = PV*(1+i)^N + PMT*AF
   * Find i such that: FV - PV*(1+i)^N - PMT*AF = 0
   */
  function solveIY(n, pv, pmt, fv, isBegin, cy, py) {
    // Objective function: FV - PV*(1+i)^N - PMT*AF = 0
    const f = (i) => {
      const compoundFactor = Math.pow(1 + i, n);
      const af = annuityFactor(i, n, isBegin);
      return fv - pv * compoundFactor - pmt * af;
    };
    
    // Derivative for Newton-Raphson
    // d/di of [FV - PV*(1+i)^N - PMT*AF]
    // = -PV*N*(1+i)^(N-1) - PMT*dAF/di
    const df = (i) => {
      if (Math.abs(i) < 1e-10) {
        // Derivative at i≈0: approximate
        return -pv * n - pmt * n * (n + 1) / 2;
      }
      
      const onePlusI = 1 + i;
      const onePlusIN = Math.pow(onePlusI, n);
      
      // d/di of (1+i)^N = N * (1+i)^(N-1)
      const dCompound = n * Math.pow(onePlusI, n - 1);
      
      // d/di of annuity factor AF = [(1+i)^N - 1] / i
      const af = (onePlusIN - 1) / i;
      const dAf = (n * Math.pow(onePlusI, n - 1) * i - (onePlusIN - 1)) / (i * i);
      const dAfBgn = isBegin ? (dAf * onePlusI + af) : dAf;
      
      return -pv * dCompound - pmt * dAfBgn;
    };
    
    // Try Newton-Raphson first
    let i = 0.05; // Initial guess: 5% periodic
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
      
      // Keep rate in reasonable bounds
      if (newI <= -0.99) newI = i / 2;
      if (newI > 10) newI = (i + 10) / 2;
      
      if (Math.abs(newI - i) < 1e-12) {
        bestI = newI;
        break;
      }
      
      i = newI;
    }
    
    // If Newton didn't converge well, try bisection
    if (Math.abs(f(bestI)) > 1e-6) {
      bestI = bisectionSolveI(f, -0.99, 2, 100);
    }
    
    // Convert periodic rate back to nominal annual rate
    // i_period = (1 + r/CY)^(CY/PY) - 1
    // Solve for r: r = CY * [(1 + i_period)^(PY/CY) - 1]
    let nominalRate;
    if (cy === py) {
      nominalRate = bestI * py;
    } else {
      nominalRate = cy * (Math.pow(1 + bestI, py / cy) - 1);
    }
    
    return nominalRate * 100; // Return as percentage
  }

  function bisectionSolveI(f, lo, hi, maxIter) {
    let fLo = f(lo), fHi = f(hi);
    
    // Adjust bounds if needed
    if (fLo * fHi > 0) {
      // Try to find a sign change
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

  // ===== CPT (COMPUTE) =====
  
  function compute() {
    clearMessage();
    state.rclMode = false;
    
    // Check if P/Y and C/Y are set (must be > 0)
    if (state.py <= 0 || state.cy <= 0) {
      showMessage('SET P/Y AND C/Y', 'error');
      return;
    }
    
    // Find which variable is blank
    const tvmVars = ['N', 'IY', 'PV', 'PMT', 'FV'];
    const blankVars = tvmVars.filter(v => state[v] === null);
    
    if (blankVars.length === 0) {
      // All registers are set
      if (state.lastComputedVar) {
        // Recompute the same variable that was last computed
        // This allows: change an input, press CPT, get new result
        computeVariable(state.lastComputedVar);
      } else {
        // No previous computation - arm CPT mode so user can select which to solve
        state.computeArmed = true;
        showMessage('CPT → PRESS VARIABLE TO SOLVE', 'info');
      }
      return;
    }
    
    if (blankVars.length > 1) {
      showMessage('CLEAR ONE VARIABLE TO SOLVE', 'error');
      return;
    }
    
    const solveFor = blankVars[0];
    
    // Get values
    const n = state.N;
    const iy = state.IY;
    const pv = state.PV;
    const pmt = state.PMT;
    const fv = state.FV;
    // Use effective values (should be > 0 at this point due to check above)
    const cy = state.cy;
    const py = state.py;
    const isBegin = state.BGN;
    
    let result;
    
    try {
      switch (solveFor) {
        case 'FV': {
          const i = getPeriodicRate(iy, cy, py);
          result = solveFV(n, i, pv, pmt, isBegin);
          break;
        }
        case 'PV': {
          const i = getPeriodicRate(iy, cy, py);
          result = solvePV(n, i, pmt, fv, isBegin);
          break;
        }
        case 'PMT': {
          const i = getPeriodicRate(iy, cy, py);
          result = solvePMT(n, i, pv, fv, isBegin);
          break;
        }
        case 'N': {
          const i = getPeriodicRate(iy, cy, py);
          result = solveN(i, pv, pmt, fv, isBegin);
          break;
        }
        case 'IY': {
          result = solveIY(n, pv, pmt, fv, isBegin, cy, py);
          break;
        }
      }
      
      if (!isFinite(result) || isNaN(result)) {
        showMessage('No solution found', 'error');
        return;
      }
      
      // Store result
      state[solveFor] = result;
      state.lastComputed = result;
      state.lastComputedVar = solveFor;
      state.entry = formatNumber(result).replace(/,/g, '');
      state.selectedVar = solveFor;
      state.isNewEntry = true;
      
      showMessage(`${solveFor === 'IY' ? 'I/Y' : solveFor} = ${formatNumber(result)}`, 'success');
      updateDisplay();
      
    } catch (e) {
      console.error('Compute error:', e);
      showMessage('Calculation error', 'error');
    }
  }

  /**
   * Compute a specific variable (used when CPT is armed and user presses a TVM key)
   * This temporarily treats the selected variable as null, computes it, then stores the result
   */
  function computeVariable(varName) {
    // Disarm CPT mode
    state.computeArmed = false;
    clearMessage();
    
    // Check if P/Y and C/Y are set
    if (state.py <= 0 || state.cy <= 0) {
      showMessage('SET P/Y AND C/Y', 'error');
      return;
    }
    
    // Temporarily set this variable to null so we can compute it
    const originalValue = state[varName];
    state[varName] = null;
    
    // Get values (the target is now null)
    const n = state.N;
    const iy = state.IY;
    const pv = state.PV;
    const pmt = state.PMT;
    const fv = state.FV;
    const cy = state.cy;
    const py = state.py;
    const isBegin = state.BGN;
    
    let result;
    
    try {
      switch (varName) {
        case 'FV': {
          const i = getPeriodicRate(iy, cy, py);
          result = solveFV(n, i, pv, pmt, isBegin);
          break;
        }
        case 'PV': {
          const i = getPeriodicRate(iy, cy, py);
          result = solvePV(n, i, pmt, fv, isBegin);
          break;
        }
        case 'PMT': {
          const i = getPeriodicRate(iy, cy, py);
          result = solvePMT(n, i, pv, fv, isBegin);
          break;
        }
        case 'N': {
          const i = getPeriodicRate(iy, cy, py);
          result = solveN(i, pv, pmt, fv, isBegin);
          break;
        }
        case 'IY': {
          result = solveIY(n, pv, pmt, fv, cy, py, isBegin);
          break;
        }
        default:
          // Restore original value if unknown variable
          state[varName] = originalValue;
          showMessage('Invalid variable', 'error');
          return;
      }
      
      if (!isFinite(result)) {
        // Restore original value on error
        state[varName] = originalValue;
        showMessage('No solution found', 'error');
        return;
      }
      
      // Store result
      state[varName] = result;
      state.lastComputed = result;
      state.lastComputedVar = varName;
      state.entry = formatNumber(result).replace(/,/g, '');
      state.selectedVar = varName;
      state.isNewEntry = true;
      
      const label = varName === 'IY' ? 'I/Y' : varName;
      showMessage(`${label} = ${formatNumber(result)}`, 'success');
      updateDisplay();
      
    } catch (e) {
      console.error('Compute error:', e);
      // Restore original value on error
      state[varName] = originalValue;
      showMessage('Calculation error', 'error');
    }
  }

  // ===== CLEAR FUNCTIONS =====
  
  function clearEntry() {
    // Clear any armed modes
    state.computeArmed = false;
    state.rclMode = false;
    
    // CE clears entry buffer only (does NOT clear TVM registers)
    // To clear a register to null: press its key with empty entry
    state.entry = '0';
    state.isNewEntry = true;
    state.operator = null;
    state.operand = null;
    
    clearMessage();
    updateDisplay();
  }

  function clearTVM() {
    state.N = null;
    state.IY = null;
    state.PV = null;
    state.PMT = null;
    state.FV = null;
    state.lastComputedVar = null;
    state.selectedVar = null;
  }

  function reset() {
    state.N = null;
    state.IY = null;
    state.PV = null;
    state.PMT = null;
    state.FV = null;
    state.cy = 0;  // Unset - user must configure
    state.py = 0;  // Unset - user must configure
    console.log('RESET: P/Y and C/Y cleared (unset)');
    state.BGN = false;
    state.entry = '0';
    state.isNewEntry = true;
    state.selectedVar = null;
    state.memory = 0;
    state.lastComputed = null;
    state.lastComputedVar = null;
    state.operator = null;
    state.operand = null;
    state.rclMode = false;
    
    // Reset CF and AMORT state
    state.cashFlows = [0];
    state.cfIndex = 0;
    state.cfDiscountRate = null;
    state.amortP1 = 1;
    state.amortP2 = 1;
    state.amortResults = null;
    
    // Return to TVM mode
    setMode('tvm');
    
    showMessage('Calculator reset', 'info');
    updateDisplay();
  }

  // ===== RCL (RECALL) =====
  
  function toggleRCL() {
    state.rclMode = !state.rclMode;
    
    if (state.rclMode) {
      showMessage('RCL: Press variable key to recall', 'info');
    } else {
      clearMessage();
    }
    
    updateDisplay();
  }

  function recallVariable(varName) {
    const value = state[varName];
    
    if (value !== null) {
      state.entry = String(value);
      state.isNewEntry = true;
      showMessage(`Recalled ${varName === 'IY' ? 'I/Y' : varName}`, 'success');
    } else {
      showMessage(`${varName === 'IY' ? 'I/Y' : varName} not set`, 'error');
    }
    
    state.rclMode = false;
    updateDisplay();
  }

  // ===== ARROW NAVIGATION =====
  
  /**
   * Select a TVM variable row without storing anything
   * This just highlights the row - does NOT transfer entry buffer value
   */
  function selectVariable(varName) {
    // Do NOT transfer any values - just highlight the row
    state.selectedVar = varName;
    updateDisplay();
  }
  
  function navigateUp() {
    const vars = ['N', 'IY', 'PV', 'PMT', 'FV'];
    const currentIdx = vars.indexOf(state.selectedVar);
    
    if (currentIdx > 0) {
      selectVariable(vars[currentIdx - 1]);
    } else {
      selectVariable(vars[vars.length - 1]);
    }
  }

  function navigateDown() {
    const vars = ['N', 'IY', 'PV', 'PMT', 'FV'];
    const currentIdx = vars.indexOf(state.selectedVar);
    
    if (currentIdx < vars.length - 1 && currentIdx >= 0) {
      selectVariable(vars[currentIdx + 1]);
    } else {
      selectVariable(vars[0]);
    }
  }

  // ===== BASIC ARITHMETIC =====
  
  function setOperator(op) {
    state.operand = getEntryValue();
    state.operator = op;
    state.isNewEntry = true;
  }

  function calculate() {
    if (state.operator === null || state.operand === null) return;
    
    const b = getEntryValue();
    const a = state.operand;
    let result;
    
    switch (state.operator) {
      case 'add': result = a + b; break;
      case 'subtract': result = a - b; break;
      case 'multiply': result = a * b; break;
      case 'divide': 
        if (b === 0) {
          showMessage('Cannot divide by zero', 'error');
          return;
        }
        result = a / b; 
        break;
      default: return;
    }
    
    state.entry = String(result);
    state.operator = null;
    state.operand = null;
    state.isNewEntry = true;
    
    updateDisplay();
  }

  // ===== BGN TOGGLE =====
  
  function toggleBGN() {
    state.BGN = !state.BGN;
    showMessage(state.BGN ? 'Begin mode' : 'End mode', 'info');
    updateDisplay();
  }

  // ===== xP/Y (Alias for P/Y) =====
  // xP/Y behaves exactly like P/Y - it does NOT copy C/Y to P/Y
  function setXPY() {
    // xP/Y is an alias for P/Y - call the same handler
    handleSettingKey('PY');
  }

  // ===== P/Y and C/Y SETTER FUNCTIONS =====
  
  /**
   * Set P/Y (payments per year)
   * @param {number} value - integer 1..999
   * @returns {boolean} - true if set successfully
   */
  function setPY(value) {
    // Check if value is an integer
    if (!Number.isInteger(value)) {
      showMessage('P/Y must be integer', 'error');
      return false;
    }
    if (value < 1 || value > 999) {
      showMessage('P/Y must be 1-999', 'error');
      return false;
    }
    state.py = value;
    console.log('P/Y set to', state.py);
    return true;
  }
  
  /**
   * Set C/Y (compounding periods per year)
   * @param {number} value - integer 1..999
   * @returns {boolean} - true if set successfully
   */
  function setCY(value) {
    // Check if value is an integer
    if (!Number.isInteger(value)) {
      showMessage('C/Y must be integer', 'error');
      return false;
    }
    if (value < 1 || value > 999) {
      showMessage('C/Y must be 1-999', 'error');
      return false;
    }
    state.cy = value;
    console.log('C/Y set to', state.cy);
    return true;
  }
  
  /**
   * Handle P/Y or C/Y button press
   * - If entry buffer has a value, store it
   * - If entry buffer is empty, just show current value
   */
  function handleSettingKey(varName) {
    clearMessage();
    state.rclMode = false;
    state.computeArmed = false;
    
    const isPY = (varName === 'PY');
    const label = isPY ? 'P/Y' : 'C/Y';
    const currentValue = isPY ? state.py : state.cy;
    
    // If entry buffer has a value, store it (ONE press stores)
    if (hasEntryValue()) {
      const value = getEntryValue();
      
      // Use the setter function
      const success = isPY ? setPY(value) : setCY(value);
      
      if (success) {
        console.log('Stored', label, '=', isPY ? state.py : state.cy, 'entryBuffer was:', state.entry);
        showMessage(`${label} = ${isPY ? state.py : state.cy}`, 'success');
        // Clear entry buffer IMMEDIATELY after storing
        state.entry = '0';
        state.isNewEntry = true;
        console.log('Entry buffer cleared: entry="0", isNewEntry=true');
      }
    } else {
      // Entry buffer is empty - just show current value (don't clear P/Y or C/Y)
      const displayVal = currentValue > 0 ? currentValue : '(not set)';
      showMessage(`${label} = ${displayVal}`, 'info');
    }
    
    updateDisplay();
  }

  // ===== MODE SWITCHING =====
  
  function setMode(newMode) {
    state.mode = newMode;
    
    // Get all mode-specific elements
    const tvmTable = document.querySelector('.tvm-table');
    const settingsPanel = document.querySelector('.settings-panel');
    
    // Hide all panels' children
    if (tvmTable) tvmTable.style.display = 'none';
    if (settingsPanel) settingsPanel.style.display = 'none';
    if (elements.cfPanel) elements.cfPanel.style.display = 'none';
    if (elements.amortPanel) elements.amortPanel.style.display = 'none';
    
    // Show the active panel's children
    switch (newMode) {
      case 'tvm':
        if (tvmTable) tvmTable.style.display = '';
        if (settingsPanel) settingsPanel.style.display = '';
        break;
      case 'cf':
        if (elements.cfPanel) {
          elements.cfPanel.style.display = 'flex';
        }
        updateCFDisplay();
        break;
      case 'amort':
        if (elements.amortPanel) {
          elements.amortPanel.style.display = 'flex';
        }
        updateAmortDisplay();
        break;
    }
    
    updateDisplay();
  }

  // ===== CASH FLOW FUNCTIONS =====
  
  function enterCFMode() {
    if (state.mode === 'cf') {
      // Already in CF mode, go back to TVM
      setMode('tvm');
      showMessage('Exited Cash Flow mode', 'info');
    } else {
      setMode('cf');
      state.cfIndex = 0;
      showMessage('Cash Flow mode - Enter CF0', 'info');
    }
  }
  
  function updateCFDisplay() {
    if (!elements.cfList) return;
    
    // Rebuild CF list
    elements.cfList.innerHTML = '';
    
    for (let i = 0; i < state.cashFlows.length; i++) {
      const row = document.createElement('div');
      row.className = 'cf-row' + (i === state.cfIndex ? ' selected' : '');
      row.dataset.cfIdx = i;
      
      const label = document.createElement('span');
      label.className = 'cf-label';
      label.textContent = 'CF' + i;
      
      const value = document.createElement('span');
      value.className = 'cf-value';
      value.textContent = formatNumber(state.cashFlows[i]);
      
      row.appendChild(label);
      row.appendChild(value);
      elements.cfList.appendChild(row);
    }
    
    // Update count
    if (elements.cfCount) {
      elements.cfCount.textContent = state.cashFlows.length + ' entries';
    }
    
    // Update index display
    if (elements.cfIndex) {
      elements.cfIndex.textContent = 'CF' + state.cfIndex;
    }
  }
  
  function navigateCF(direction) {
    if (state.mode !== 'cf') return;
    
    if (direction === 'up' && state.cfIndex > 0) {
      state.cfIndex--;
    } else if (direction === 'down') {
      if (state.cfIndex < state.cashFlows.length - 1) {
        state.cfIndex++;
      } else {
        // Add new cash flow entry
        state.cashFlows.push(0);
        state.cfIndex = state.cashFlows.length - 1;
      }
    }
    
    state.entry = String(state.cashFlows[state.cfIndex]);
    state.isNewEntry = true;
    updateCFDisplay();
    updateDisplay();
  }
  
  function storeCashFlow() {
    if (state.mode !== 'cf') return;
    
    const value = getEntryValue();
    state.cashFlows[state.cfIndex] = value;
    
    showMessage(`CF${state.cfIndex} = ${formatNumber(value)}`, 'success');
    state.isNewEntry = true;
    updateCFDisplay();
  }
  
  function deleteCashFlow() {
    if (state.mode !== 'cf') return;
    
    if (state.cashFlows.length <= 1) {
      // Can't delete CF0, just reset it
      state.cashFlows[0] = 0;
      showMessage('CF0 reset to 0', 'info');
    } else if (state.cfIndex > 0) {
      state.cashFlows.splice(state.cfIndex, 1);
      if (state.cfIndex >= state.cashFlows.length) {
        state.cfIndex = state.cashFlows.length - 1;
      }
      showMessage('Cash flow deleted', 'info');
    } else {
      showMessage('Cannot delete CF0', 'error');
    }
    
    state.entry = String(state.cashFlows[state.cfIndex]);
    state.isNewEntry = true;
    updateCFDisplay();
    updateDisplay();
  }

  // ===== NPV CALCULATION =====
  
  function calculateNPV() {
    if (state.cashFlows.length < 2) {
      showMessage('Enter at least 2 cash flows', 'error');
      return;
    }
    
    // Check P/Y is set
    if (state.py <= 0) {
      showMessage('SET P/Y first', 'error');
      return;
    }
    
    // Get discount rate - use I/Y if set, otherwise prompt
    let rate = state.IY;
    if (rate === null) {
      // If currently entering a number, use that as the rate
      if (!state.isNewEntry && state.entry !== '0') {
        rate = getEntryValue();
        state.IY = rate;
      } else {
        showMessage('Set I/Y first (discount rate)', 'error');
        return;
      }
    }
    
    // Convert annual rate to periodic rate (using P/Y)
    const periodicRate = rate / 100 / state.py;
    
    // Calculate NPV: CF0 + CF1/(1+r) + CF2/(1+r)^2 + ...
    let npv = 0;
    for (let t = 0; t < state.cashFlows.length; t++) {
      npv += state.cashFlows[t] / Math.pow(1 + periodicRate, t);
    }
    
    state.lastComputed = npv;
    state.entry = formatNumber(npv).replace(/,/g, '');
    state.isNewEntry = true;
    
    showMessage(`NPV = ${formatNumber(npv)}`, 'success');
    
    // Switch to TVM mode to show result
    setMode('tvm');
    updateDisplay();
  }

  // ===== IRR CALCULATION =====
  
  function calculateIRR() {
    if (state.cashFlows.length < 2) {
      showMessage('Enter at least 2 cash flows', 'error');
      return;
    }
    
    // Check P/Y is set
    if (state.py <= 0) {
      showMessage('SET P/Y first', 'error');
      return;
    }
    
    // Check that we have at least one sign change
    let hasPositive = false, hasNegative = false;
    for (const cf of state.cashFlows) {
      if (cf > 0) hasPositive = true;
      if (cf < 0) hasNegative = true;
    }
    
    if (!hasPositive || !hasNegative) {
      showMessage('Need both positive and negative cash flows', 'error');
      return;
    }
    
    // Newton-Raphson to find IRR
    // NPV(r) = sum of CF[t] / (1+r)^t = 0
    
    const npvFunc = (r) => {
      let npv = 0;
      for (let t = 0; t < state.cashFlows.length; t++) {
        npv += state.cashFlows[t] / Math.pow(1 + r, t);
      }
      return npv;
    };
    
    const npvDerivative = (r) => {
      let deriv = 0;
      for (let t = 1; t < state.cashFlows.length; t++) {
        deriv -= t * state.cashFlows[t] / Math.pow(1 + r, t + 1);
      }
      return deriv;
    };
    
    // Initial guess
    let r = 0.1;
    let bestR = r;
    let bestNPV = Math.abs(npvFunc(r));
    
    // Newton-Raphson iterations
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
      
      // Keep in reasonable bounds
      if (newR <= -0.99) newR = (r - 0.99) / 2;
      if (newR > 10) newR = (r + 10) / 2;
      
      if (Math.abs(newR - r) < 1e-10) {
        bestR = newR;
        break;
      }
      
      r = newR;
    }
    
    // Fallback to bisection if Newton didn't converge well
    if (Math.abs(npvFunc(bestR)) > 1e-6) {
      bestR = bisectionIRR(npvFunc, -0.99, 2, 100);
    }
    
    // Convert to annual percentage rate (* P/Y)
    const irrAnnual = bestR * state.py * 100;
    
    state.IY = irrAnnual;
    state.lastComputed = irrAnnual;
    state.entry = formatNumber(irrAnnual).replace(/,/g, '');
    state.isNewEntry = true;
    
    showMessage(`IRR = ${formatNumber(irrAnnual)}%`, 'success');
    
    // Switch to TVM mode to show result
    setMode('tvm');
    updateDisplay();
  }
  
  function bisectionIRR(f, lo, hi, maxIter) {
    let fLo = f(lo), fHi = f(hi);
    
    // Adjust bounds if needed
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

  // ===== AMORTIZATION FUNCTIONS =====
  
  function enterAmortMode() {
    // Check if TVM values are set for amortization
    if (state.N === null || state.IY === null || state.PV === null || state.PMT === null) {
      showMessage('Set N, I/Y, PV, PMT first', 'error');
      return;
    }
    
    // Check P/Y and C/Y are set
    if (state.py <= 0 || state.cy <= 0) {
      showMessage('SET P/Y AND C/Y', 'error');
      return;
    }
    
    if (state.mode === 'amort') {
      // Already in AMORT mode, go back to TVM
      setMode('tvm');
      showMessage('Exited Amortization mode', 'info');
    } else {
      // Calculate first, then switch mode to update display correctly
      state.amortP1 = 1;
      state.amortP2 = 1;
      calculateAmort();
      setMode('amort');
      showMessage('Amortization mode - Use ▲▼ to change period', 'info');
    }
  }
  
  function updateAmortDisplay() {
    if (!elements.amortRange) return;
    
    elements.amortRange.textContent = `P${state.amortP1} - P${state.amortP2}`;
    
    if (state.amortResults) {
      elements.amortPrincipal.textContent = formatNumber(state.amortResults.principal);
      elements.amortPrincipal.className = 'amort-value' + (state.amortResults.principal >= 0 ? ' positive' : ' negative');
      
      elements.amortInterest.textContent = formatNumber(state.amortResults.interest);
      elements.amortInterest.className = 'amort-value negative';
      
      elements.amortBalance.textContent = formatNumber(state.amortResults.balance);
      elements.amortBalance.className = 'amort-value';
    } else {
      elements.amortPrincipal.textContent = '—';
      elements.amortInterest.textContent = '—';
      elements.amortBalance.textContent = '—';
    }
  }
  
  function navigateAmort(direction) {
    if (state.mode !== 'amort') return;
    
    const maxN = Math.floor(state.N);
    
    if (direction === 'up') {
      // Move to previous period or range
      if (state.amortP1 > 1) {
        state.amortP1--;
        state.amortP2 = state.amortP1;
      }
    } else if (direction === 'down') {
      // Move to next period or range
      if (state.amortP2 < maxN) {
        state.amortP1 = state.amortP2 + 1;
        state.amortP2 = state.amortP1;
      }
    }
    
    calculateAmort();
    updateAmortDisplay();
  }
  
  function calculateAmort() {
    if (state.N === null || state.IY === null || state.PV === null || state.PMT === null) {
      state.amortResults = null;
      return;
    }
    
    // Check P/Y and C/Y are set
    if (state.py <= 0 || state.cy <= 0) {
      state.amortResults = null;
      return;
    }
    
    const n = state.N;
    const pv = state.PV;
    const pmt = state.PMT;
    const i = getPeriodicRate(state.IY, state.cy, state.py);
    const isBegin = state.BGN;
    
    // Calculate amortization for periods P1 to P2
    let balance = pv;
    let totalPrincipal = 0;
    let totalInterest = 0;
    
    for (let period = 1; period <= state.amortP2; period++) {
      let interestPayment, principalPayment;
      
      if (isBegin) {
        // Beginning of period: payment first, then interest
        principalPayment = -pmt;
        balance += principalPayment;
        interestPayment = balance * i;
        balance += interestPayment;
      } else {
        // End of period: interest first, then payment
        interestPayment = balance * i;
        principalPayment = -pmt - interestPayment;
        balance += interestPayment + pmt;
      }
      
      // Accumulate for the requested range
      if (period >= state.amortP1) {
        totalPrincipal += principalPayment;
        totalInterest += interestPayment;
      }
    }
    
    state.amortResults = {
      principal: totalPrincipal,
      interest: totalInterest,
      balance: balance
    };
    
    state.entry = formatNumber(state.amortResults.balance).replace(/,/g, '');
    state.isNewEntry = true;
  }
  
  function setAmortPeriod() {
    if (state.mode !== 'amort') return;
    
    const value = Math.floor(getEntryValue());
    const maxN = Math.floor(state.N);
    
    if (value >= 1 && value <= maxN) {
      state.amortP1 = value;
      state.amortP2 = value;
      calculateAmort();
      updateAmortDisplay();
      showMessage(`Period set to P${value}`, 'info');
    } else {
      showMessage(`Period must be 1 to ${maxN}`, 'error');
    }
    
    state.isNewEntry = true;
  }

  // ===== EVENT HANDLERS =====
  
  function handleKeyClick(e) {
    const button = e.target.closest('.key');
    if (!button) return;
    
    // Visual feedback
    button.classList.add('flash');
    setTimeout(() => button.classList.remove('flash'), 150);
    
    // Handle digit keys
    if (button.dataset.digit !== undefined) {
      appendDigit(button.dataset.digit);
      return;
    }
    
    // Handle TVM variable keys (N, I/Y, PV, PMT, FV)
    if (button.dataset.var) {
      const varName = button.dataset.var;
      
      // Debug logging for every TVM key press
      console.log('Key:', varName, '| entry:', state.entry, '| isNewEntry:', state.isNewEntry, '| hasEntry:', hasEntryValue());
      
      // Handle C/Y and P/Y separately from TVM variables
      if (varName === 'CY' || varName === 'PY') {
        handleSettingKey(varName);
        return;
      }
      
      if (state.computeArmed) {
        // CPT was pressed, now user selected which variable to compute
        computeVariable(varName);
      } else if (state.rclMode) {
        recallVariable(varName);
      } else if (hasEntryValue()) {
        // Entry buffer has a value - store it into this register (ONE press stores)
        storeVariable(varName);
      } else {
        // Entry buffer is empty - CLEAR this register (set to null)
        clearRegister(varName);
      }
      return;
    }
    
    // Handle operator keys
    if (button.dataset.op) {
      setOperator(button.dataset.op);
      return;
    }
    
    // Handle action keys
    const action = button.dataset.action;
    if (!action) return;
    
    switch (action) {
      case 'decimal':
        appendDigit('.');
        break;
      case 'negate':
        negateEntry();
        break;
      case 'DEL':
        if (state.mode === 'cf') {
          deleteCashFlow();
        } else {
          deleteLastChar();
        }
        break;
      case 'CCE':
        clearEntry();
        break;
      case 'RESET':
        reset();
        break;
      case 'CPT':
        compute();
        break;
      case 'RCL':
        toggleRCL();
        break;
      case 'ENTER':
        if (state.mode === 'cf') {
          storeCashFlow();
        } else if (state.mode === 'amort') {
          setAmortPeriod();
        } else if (state.selectedVar && hasEntryValue()) {
          // In TVM mode, store to the selected variable if user has typed a value
          storeVariable(state.selectedVar);
        }
        break;
      case 'UP':
        if (state.mode === 'cf') {
          navigateCF('up');
        } else if (state.mode === 'amort') {
          navigateAmort('up');
        } else {
          navigateUp();
        }
        break;
      case 'DOWN':
        if (state.mode === 'cf') {
          navigateCF('down');
        } else if (state.mode === 'amort') {
          navigateAmort('down');
        } else {
          navigateDown();
        }
        break;
      case 'BGN':
        toggleBGN();
        break;
      case 'xPY':
        setXPY();
        break;
      case 'equals':
        calculate();
        break;
      case 'CF':
        enterCFMode();
        break;
      case 'NPV':
        calculateNPV();
        break;
      case 'IRR':
        calculateIRR();
        break;
      case 'AMORT':
        enterAmortMode();
        break;
      case 'INS':
        // Insert a new cash flow when in CF mode
        if (state.mode === 'cf') {
          state.cashFlows.splice(state.cfIndex + 1, 0, 0);
          state.cfIndex++;
          state.entry = '0';
          state.isNewEntry = true;
          updateCFDisplay();
          showMessage('Cash flow inserted', 'info');
        }
        break;
    }
  }

  // ===== KEYBOARD SUPPORT =====
  
  function handleKeyboard(e) {
    // Ignore if user is typing in an input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }
    
    // Digits - prevent default and handle
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      appendDigit(e.key);
      return;
    }
    
    // Decimal - prevent default and handle
    if (e.key === '.') {
      e.preventDefault();
      appendDigit('.');
      return;
    }
    
    // Backspace - prevent default (browser back) and handle
    if (e.key === 'Backspace') {
      e.preventDefault();
      deleteLastChar();
      return;
    }
    
    // Enter - prevent default and trigger ENTER button click (same code path as UI)
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const enterBtn = document.querySelector('[data-key="ENTER"]') || 
                       document.querySelector('[data-action="ENTER"]');
      if (enterBtn) {
        enterBtn.click();
      }
      return;
    }
    
    // Escape - clear or exit mode
    if (e.key === 'Escape') {
      e.preventDefault();
      if (state.mode !== 'tvm') {
        setMode('tvm');
        showMessage('Returned to TVM mode', 'info');
      } else {
        clearEntry();
      }
      return;
    }
    
    // Operators - prevent default and handle
    if (e.key === '+') {
      e.preventDefault();
      setOperator('add');
      return;
    }
    if (e.key === '-') {
      e.preventDefault();
      setOperator('subtract');
      return;
    }
    if (e.key === '*') {
      e.preventDefault();
      setOperator('multiply');
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      setOperator('divide');
      return;
    }
    if (e.key === '=') {
      e.preventDefault();
      calculate();
      return;
    }
    
    // Arrow keys
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (state.mode === 'cf') {
        navigateCF('up');
      } else if (state.mode === 'amort') {
        navigateAmort('up');
      } else {
        navigateUp();
      }
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (state.mode === 'cf') {
        navigateCF('down');
      } else if (state.mode === 'amort') {
        navigateAmort('down');
      } else {
        navigateDown();
      }
    }
    
    // Quick keys for TVM (with Ctrl)
    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      if (key === 'n') { e.preventDefault(); selectVariable('N'); }
      if (key === 'i') { e.preventDefault(); selectVariable('IY'); }
      if (key === 'p') { e.preventDefault(); selectVariable('PV'); }
      if (key === 'm') { e.preventDefault(); selectVariable('PMT'); }
      if (key === 'f') { e.preventDefault(); selectVariable('FV'); }
      if (key === 'c') {
        // Don't prevent default copy behavior if text is selected
        if (!window.getSelection().toString()) {
          e.preventDefault();
          compute();
        }
      }
    }
  }

  // ===== TVM ROW CLICK HANDLER =====
  
  function handleTVMRowClick(e) {
    const row = e.target.closest('.tvm-row');
    if (!row) return;
    
    const varName = row.dataset.var;
    if (varName) {
      selectVariable(varName);
    }
  }

  // ===== DIAGNOSTICS TEST RUNNER =====
  
  const diagTests = [
    {
      name: 'Test 1: FV of lump sum',
      // PV=-100 (invest $100), FV should be -259.37 (account balance)
      setup: { PY: 1, CY: 1, BGN: false, N: 10, IY: 10, PV: -100, PMT: 0, FV: null },
      solve: 'FV',
      expected: -259.37,
      tolerance: 0.1
    },
    {
      name: 'Test 2: PV of lump sum',
      // FV=-259.37 (target balance), PV should be -100 (initial investment needed)
      setup: { PY: 1, CY: 1, BGN: false, N: 10, IY: 10, PV: null, PMT: 0, FV: -259.37 },
      solve: 'PV',
      expected: -100,
      tolerance: 0.1
    },
    {
      name: 'Test 3: Loan payment (END)',
      // PV=200000 (loan received), FV=0 (paid off), solve for PMT
      setup: { PY: 12, CY: 12, BGN: false, N: 360, IY: 6, PV: 200000, PMT: null, FV: 0 },
      solve: 'PMT',
      expected: -1199.10,
      tolerance: 2
    },
    {
      name: 'Test 4: Interest solve',
      // Given loan PV=200000, PMT=-1199.10, FV=0, solve for I/Y
      setup: { PY: 12, CY: 12, BGN: false, N: 360, IY: null, PV: 200000, PMT: -1199.10, FV: 0 },
      solve: 'IY',
      expected: 6.0,
      tolerance: 0.05
    },
    {
      name: 'Test 5: BGN mode check',
      // BGN PMT should be smaller in magnitude than END PMT
      setup: { PY: 12, CY: 12, BGN: true, N: 360, IY: 6, PV: 200000, PMT: null, FV: 0 },
      solve: 'PMT',
      compare: 'Test 3',
      compareType: 'lessMagnitude'
    }
  ];
  
  function runDiagnosticTest(test, previousResults) {
    // Set up the state
    const { PY, CY, BGN, N, IY, PV, PMT, FV } = test.setup;
    
    const n = N;
    const iy = IY;
    const pv = PV;
    const pmt = PMT;
    const fv = FV;
    const cy = CY;
    const py = PY;
    const isBegin = BGN;
    
    let result;
    
    try {
      switch (test.solve) {
        case 'FV': {
          const i = getPeriodicRate(iy, cy, py);
          result = solveFV(n, i, pv, pmt, isBegin);
          break;
        }
        case 'PV': {
          const i = getPeriodicRate(iy, cy, py);
          result = solvePV(n, i, pmt, fv, isBegin);
          break;
        }
        case 'PMT': {
          const i = getPeriodicRate(iy, cy, py);
          result = solvePMT(n, i, pv, fv, isBegin);
          break;
        }
        case 'N': {
          const i = getPeriodicRate(iy, cy, py);
          result = solveN(i, pv, pmt, fv, isBegin);
          break;
        }
        case 'IY': {
          result = solveIY(n, pv, pmt, fv, isBegin, cy, py);
          break;
        }
      }
    } catch (e) {
      return { 
        name: test.name, 
        computed: 'ERROR', 
        expected: test.expected, 
        tolerance: test.tolerance,
        pass: false, 
        error: e.message 
      };
    }
    
    // Determine pass/fail
    let pass = false;
    let expectedStr = '';
    
    if (test.compare) {
      // Comparison test (Test 5)
      const refResult = previousResults[test.compare];
      if (refResult && test.compareType === 'lessMagnitude') {
        pass = Math.abs(result) < Math.abs(refResult.computed);
        expectedStr = `|${result.toFixed(4)}| < |${refResult.computed.toFixed(4)}|`;
      }
    } else {
      // Tolerance test
      pass = Math.abs(result - test.expected) <= test.tolerance;
      expectedStr = `${test.expected} ± ${test.tolerance}`;
    }
    
    return {
      name: test.name,
      computed: result,
      expected: expectedStr,
      tolerance: test.tolerance,
      pass: pass,
      solve: test.solve
    };
  }
  
  function runAllDiagnostics() {
    console.log('');
    console.log('╔═══════════════════════════════════════╗');
    console.log('║       TVM SELF-TEST DIAGNOSTICS       ║');
    console.log('╚═══════════════════════════════════════╝');
    console.log('');
    
    const results = {};
    const allResults = [];
    
    for (const test of diagTests) {
      const result = runDiagnosticTest(test, results);
      results[test.name] = result;
      allResults.push(result);
      
      // Log to console with clear formatting
      const status = result.pass ? '✓ PASS' : '✗ FAIL';
      const computedStr = typeof result.computed === 'number' 
        ? result.computed.toFixed(6) 
        : result.computed;
      
      console.log(`${status}: ${result.name}`);
      console.log(`    Computed: ${computedStr}`);
      console.log(`    Expected: ${result.expected}`);
      if (!result.pass && result.error) {
        console.log(`    Error: ${result.error}`);
      }
      console.log('');
    }
    
    const passed = allResults.filter(r => r.pass).length;
    const total = allResults.length;
    
    console.log('═══════════════════════════════════════');
    if (passed === total) {
      console.log(`✓ ALL TESTS PASSED: ${passed}/${total}`);
    } else {
      console.log(`✗ TESTS FAILED: ${passed}/${total} passed`);
    }
    console.log('═══════════════════════════════════════');
    
    return allResults;
  }
  
  // Alias for external calling
  function runSelfTests() {
    return runAllDiagnostics();
  }
  
  // Expose runSelfTests globally for console access
  window.runSelfTests = runSelfTests;
  
  function displayDiagResults(results) {
    const body = document.getElementById('diag-body');
    if (!body) return;
    
    const passed = results.filter(r => r.pass).length;
    const total = results.length;
    const allPass = passed === total;
    
    let html = '<div class="test-results">';
    
    for (const result of results) {
      const statusClass = result.pass ? 'pass' : 'fail';
      const statusText = result.pass ? '✓ PASS' : '✗ FAIL';
      const computedStr = typeof result.computed === 'number' 
        ? result.computed.toFixed(4) 
        : result.computed;
      
      html += `
        <div class="test-result ${statusClass}">
          <div class="test-name">${result.name}</div>
          <div class="test-details">
            <span>Solve for: ${result.solve}</span>
            <span>Computed: ${computedStr}</span>
            <span>Expected: ${result.expected}</span>
          </div>
          <div class="test-status ${statusClass}">${statusText}</div>
        </div>
      `;
    }
    
    html += '</div>';
    
    // Summary
    const summaryClass = allPass ? 'all-pass' : 'has-fail';
    const summaryTextClass = allPass ? 'pass' : 'fail';
    const summaryIcon = allPass ? '✓' : '✗';
    
    html += `
      <div class="test-summary ${summaryClass}">
        <div class="summary-text ${summaryTextClass}">
          ${summaryIcon} ${passed}/${total} Tests Passed
        </div>
      </div>
    `;
    
    body.innerHTML = html;
  }
  
  function initDiagnostics() {
    const diagBtn = document.getElementById('diag-btn');
    const diagModal = document.getElementById('diag-modal');
    const diagClose = document.getElementById('diag-close');
    const diagRun = document.getElementById('diag-run');
    
    if (!diagBtn || !diagModal) return;
    
    // Open modal
    diagBtn.addEventListener('click', () => {
      diagModal.classList.add('show');
    });
    
    // Close modal
    diagClose.addEventListener('click', () => {
      diagModal.classList.remove('show');
    });
    
    // Close on backdrop click
    diagModal.addEventListener('click', (e) => {
      if (e.target === diagModal) {
        diagModal.classList.remove('show');
      }
    });
    
    // Run tests
    diagRun.addEventListener('click', () => {
      diagRun.disabled = true;
      diagRun.textContent = 'Running...';
      
      // Small delay for visual feedback
      setTimeout(() => {
        const results = runAllDiagnostics();
        displayDiagResults(results);
        diagRun.disabled = false;
        diagRun.textContent = 'Run Tests';
      }, 100);
    });
  }

  // ===== INITIALIZATION =====
  
  function init() {
    // Re-initialize DOM elements in case they weren't available at script parse time
    elements.tvmPanel = document.getElementById('tvm-panel');
    elements.cfPanel = document.getElementById('cf-panel');
    elements.amortPanel = document.getElementById('amort-panel');
    elements.cfList = document.getElementById('cf-list');
    elements.cfCount = document.getElementById('cf-count');
    elements.cfIndex = document.getElementById('cf-index');
    elements.amortRange = document.getElementById('amort-range');
    elements.amortPrincipal = document.getElementById('amort-principal');
    elements.amortInterest = document.getElementById('amort-interest');
    elements.amortBalance = document.getElementById('amort-balance');
    
    // Attach event listeners
    document.querySelector('.keypad').addEventListener('click', handleKeyClick);
    const tvmTable = document.querySelector('.tvm-table');
    if (tvmTable) {
      tvmTable.addEventListener('click', handleTVMRowClick);
    }
    // Global keyboard handler - use window and capture phase for reliability
    window.addEventListener('keydown', handleKeyboard, true);
    
    // Ensure body can receive focus for keyboard events
    document.body.tabIndex = 0;
    document.body.focus();
    
    // Re-focus body on any click/tap to ensure keyboard works
    document.addEventListener('click', () => {
      // Only refocus if not clicking an input/textarea
      if (document.activeElement.tagName !== 'INPUT' && 
          document.activeElement.tagName !== 'TEXTAREA') {
        document.body.focus();
      }
    });
    
    // Initialize diagnostics
    initDiagnostics();
    
    // Initialize mode to TVM
    setMode('tvm');
    
    // Initial display update
    updateDisplay();
    
    // Register service worker (disabled to prevent caching issues)
    if (ENABLE_SW && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('Service worker registered'))
        .catch(err => console.log('Service worker registration failed:', err));
    }
    
    console.log('Financial Calculator initialized');
  }

  // Start the app
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
