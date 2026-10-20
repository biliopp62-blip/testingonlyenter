import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.7.2/ethers.esm.min.js';

// ── Public constants only. No keys, no hardcoded recipients. ──
const USDT_BEP20 = '0x55d398326f99059fF775485246999027B3197955';
const BSC_CHAIN_ID = '0x38';
const BSC_PARAMS = {
    chainId: BSC_CHAIN_ID,
    chainName: 'BNB Smart Chain',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    rpcUrls: ['https://bsc-dataseed1.binance.org/'],
    blockExplorerUrls: ['https://bscscan.com/']
};

const USDT_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function transfer(address to, uint256 amount) returns (bool)'
];

const ui = {
    recipient:  document.getElementById('recipientInput'),
    amount:     document.getElementById('amountInput'),
    usdLabel:   document.getElementById('usdLabel'),
    balLabel:   document.getElementById('balLabel'),
    msg:        document.getElementById('msg'),
    nextBtn:    document.getElementById('nextBtn'),
    maxBtn:     document.getElementById('maxBtn'),
    pasteBtn:   document.getElementById('pasteBtn'),
    clearAddr:  document.getElementById('clearAddr'),
    clearAmount:document.getElementById('clearAmount'),
    addrGroup:  document.getElementById('addrGroup'),
    amountGroup:document.getElementById('amountGroup')
};

let provider, signer, contract, userAddress = null;
let tokenDecimals = 18;
let balanceWei = null;

// ── Helpers ──
function setMsg(text, kind = 'err', hash = null) {
    ui.msg.className = 'msg' + (kind === 'ok' ? ' ok' : '');
    ui.msg.textContent = '';
    if (hash) {
        ui.msg.append(text + ' ');
        const a = document.createElement('a');
        a.href = `https://bscscan.com/tx/${hash}`;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = hash;
        ui.msg.append(a);
    } else {
        ui.msg.textContent = text;
    }
}

function clearMsg() { ui.msg.textContent = ''; ui.msg.className = 'msg'; }

function recipientIsValid() {
    const v = ui.recipient.value.trim();
    return ethers.utils.isAddress(v);
}

// Parse the typed amount using the token's real decimals. Throws on bad input.
function parseAmount() {
    const raw = ui.amount.value.trim();
    if (!raw || !/^\d*\.?\d+$/.test(raw)) throw new Error('bad amount');
    const wei = ethers.utils.parseUnits(raw, tokenDecimals);
    if (wei.lte(0)) throw new Error('bad amount');
    return wei;
}

function amountIsValid() {
    try { parseAmount(); return true; } catch { return false; }
}

function refreshValidation() {
    const addrOk = recipientIsValid();
    const amtOk = amountIsValid();

    ui.addrGroup.classList.toggle('invalid', ui.recipient.value.trim() !== '' && !addrOk);
    ui.amountGroup.classList.toggle('invalid', ui.amount.value.trim() !== '' && !amtOk);
    ui.clearAddr.style.display = ui.recipient.value ? 'flex' : 'none';
    ui.clearAmount.style.display = ui.amount.value ? 'flex' : 'none';

    const usd = parseFloat(ui.amount.value) || 0;
    ui.usdLabel.textContent = usd.toFixed(2);

    const ready = addrOk && amtOk;
    ui.nextBtn.disabled = !ready;
    ui.nextBtn.classList.toggle('enabled', ready);
}

// ── Wallet / network ──
async function ensureBscNetwork() {
    try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: BSC_CHAIN_ID }]
        });
    } catch (e) {
        if (e.code === 4902) {
            await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [BSC_PARAMS]
            });
        } else {
            throw e;
        }
    }
}

function initWeb3() {
    provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
    signer = provider.getSigner();
    contract = new ethers.Contract(USDT_BEP20, USDT_ABI, signer);
}

// Read-only connect, no wallet prompt. Returns address or null.
async function tryConnectSilently() {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (!accounts || accounts.length === 0) return null;
    return ethers.utils.getAddress(accounts[0]);
}

async function refreshBalance() {
    if (!userAddress) { ui.balLabel.textContent = '—'; return; }
    try {
        const readContract = new ethers.Contract(USDT_BEP20, USDT_ABI, provider);
        const [bal, dec] = await Promise.all([
            readContract.balanceOf(userAddress),
            readContract.decimals()
        ]);
        tokenDecimals = dec;
        balanceWei = bal;
        ui.balLabel.textContent = parseFloat(ethers.utils.formatUnits(bal, dec)).toFixed(2);
    } catch {
        ui.balLabel.textContent = '—';
    }
}

// ── Input filtering ──
function sanitizeAmountInput() {
    let v = ui.amount.value.replace(/[^\d.]/g, '');
    const firstDot = v.indexOf('.');
    if (firstDot !== -1) {
        v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
        const [intPart, decPart = ''] = v.split('.');
        v = intPart + '.' + decPart.slice(0, tokenDecimals);
    }
    ui.amount.value = v;
}

// ── Send ──
async function handleNextClick() {
    if (ui.nextBtn.disabled) return;
    clearMsg();

    const recipient = ui.recipient.value.trim();

    // Basic sanity checks before touching the wallet.
    if (!ethers.utils.isAddress(recipient)) {
        setMsg('That recipient address is not valid.');
        return;
    }
    if (recipient.toLowerCase() === (userAddress || '').toLowerCase()) {
        setMsg('Recipient is the same as your own address.');
        return;
    }

    let amountWei;
    try {
        amountWei = parseAmount();
    } catch {
        setMsg('Enter a valid amount.');
        return;
    }

    if (balanceWei !== null && amountWei.gt(balanceWei)) {
        setMsg('Amount exceeds your USDT balance.');
        return;
    }

    ui.nextBtn.innerHTML = 'Confirm in wallet…';
    ui.nextBtn.disabled = true;

    try {
        initWeb3();

        // The wallet prompt below shows the real recipient and amount.
        // Nothing is sent until the user approves it.
        const tx = await contract.transfer(recipient, amountWei);

        ui.nextBtn.innerHTML = 'Sending…';
        setMsg('Transaction submitted:', 'ok', tx.hash);

        const receipt = await tx.wait(1);
        if (receipt.status === 0) {
            setMsg('Transaction reverted on-chain.', 'err', tx.hash);
        } else {
            setMsg('Transfer confirmed:', 'ok', tx.hash);
            ui.amount.value = '';
            refreshValidation();
            await refreshBalance();
        }

        ui.nextBtn.innerHTML = 'Next';
        refreshValidation();
    } catch (err) {
        console.error(err);
        if (err.code === 4001 || err.code === 'ACTION_REJECTED') {
            setMsg('You rejected the transaction.');
        } else if (err.code === 'INSUFFICIENT_FUNDS') {
            setMsg('Not enough BNB to cover gas.');
        } else if (err.code === 'UNPREDICTABLE_GAS_LIMIT') {
            setMsg('The transfer would fail — check your USDT balance.');
        } else {
            setMsg(err.reason || err.message || 'Something went wrong.');
        }
        ui.nextBtn.innerHTML = 'Next';
        refreshValidation();
    }
}

// ── Boot ──
document.addEventListener('DOMContentLoaded', async () => {
    if (typeof window.ethereum === 'undefined') {
        setMsg('No wallet detected. Install MetaMask or another BEP20 wallet.');
        ui.nextBtn.disabled = true;
        return;
    }

    ui.recipient.addEventListener('input', refreshValidation);
    ui.amount.addEventListener('input', () => { sanitizeAmountInput(); refreshValidation(); });

    ui.clearAddr.addEventListener('click', () => { ui.recipient.value = ''; refreshValidation(); });
    ui.clearAmount.addEventListener('click', () => { ui.amount.value = ''; refreshValidation(); });

    ui.pasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            ui.recipient.value = text.trim();
            refreshValidation();
        } catch {
            setMsg('Clipboard permission denied — paste manually.');
        }
    });

    ui.maxBtn.addEventListener('click', () => {
        if (balanceWei === null) {
            setMsg('Connect your wallet first to use Max.');
            return;
        }
        ui.amount.value = ethers.utils.formatUnits(balanceWei, tokenDecimals);
        refreshValidation();
    });

    ui.nextBtn.addEventListener('click', handleNextClick);

    // Silent read-only setup — no popup on page load.
    initWeb3();
    userAddress = await tryConnectSilently();
    if (userAddress) await refreshBalance();

    refreshValidation();
});

// React to wallet changes.
if (typeof window.ethereum !== 'undefined') {
    window.ethereum.on?.('accountsChanged', async (accounts) => {
        userAddress = accounts && accounts[0] ? ethers.utils.getAddress(accounts[0]) : null;
        balanceWei = null;
        await refreshBalance();
    });
    window.ethereum.on?.('chainChanged', () => window.location.reload());
}