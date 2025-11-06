import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface TradeFinanceData {
  id: string;
  name: string;
  invoiceAmount: string;
  riskScore: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [tradeData, setTradeData] = useState<TradeFinanceData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingTrade, setCreatingTrade] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newTradeData, setNewTradeData] = useState({ 
    companyName: "", 
    invoiceAmount: "", 
    description: "" 
  });
  const [selectedTrade, setSelectedTrade] = useState<TradeFinanceData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [stats, setStats] = useState({
    totalApplications: 0,
    approved: 0,
    pending: 0,
    totalVolume: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [contractAddress, setContractAddress] = useState("");

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const tradeList: TradeFinanceData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          tradeList.push({
            id: businessId,
            name: businessData.name,
            invoiceAmount: businessId,
            riskScore: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setTradeData(tradeList);
      updateStats(tradeList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (data: TradeFinanceData[]) => {
    const totalApplications = data.length;
    const approved = data.filter(item => item.isVerified).length;
    const pending = totalApplications - approved;
    const totalVolume = data.reduce((sum, item) => sum + (item.decryptedValue || 0), 0);
    
    setStats({ totalApplications, approved, pending, totalVolume });
  };

  const checkAvailability = async () => {
    if (!isConnected) {
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return;
    }
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: `System available: ${available}` 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const createTrade = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingTrade(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating trade finance application with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const invoiceValue = parseInt(newTradeData.invoiceAmount) || 0;
      const businessId = `trade-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, invoiceValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newTradeData.companyName,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        Math.floor(Math.random() * 100) + 1,
        0,
        newTradeData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Trade application created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewTradeData({ companyName: "", invoiceAmount: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingTrade(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Invoice decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const filteredData = tradeData.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === "all" || 
                         (filterStatus === "verified" && item.isVerified) ||
                         (filterStatus === "pending" && !item.isVerified);
    return matchesSearch && matchesFilter;
  });

  const renderStats = () => {
    return (
      <div className="stats-grid">
        <div className="stat-card neon-purple">
          <h3>Total Applications</h3>
          <div className="stat-value">{stats.totalApplications}</div>
          <div className="stat-trend">FHE Protected</div>
        </div>
        
        <div className="stat-card neon-blue">
          <h3>Approved</h3>
          <div className="stat-value">{stats.approved}</div>
          <div className="stat-trend">On-chain Verified</div>
        </div>
        
        <div className="stat-card neon-pink">
          <h3>Pending Review</h3>
          <div className="stat-value">{stats.pending}</div>
          <div className="stat-trend">Awaiting FHE Decryption</div>
        </div>
        
        <div className="stat-card neon-green">
          <h3>Total Volume</h3>
          <div className="stat-value">${stats.totalVolume}K</div>
          <div className="stat-trend">Encrypted Amounts</div>
        </div>
      </div>
    );
  };

  const renderRiskChart = (trade: TradeFinanceData) => {
    const riskLevel = trade.publicValue1;
    const amount = trade.decryptedValue || trade.publicValue2;
    
    return (
      <div className="risk-chart">
        <div className="chart-header">
          <h4>Risk Assessment</h4>
          <span className={`risk-badge ${riskLevel <= 30 ? 'low' : riskLevel <= 70 ? 'medium' : 'high'}`}>
            {riskLevel <= 30 ? 'Low Risk' : riskLevel <= 70 ? 'Medium Risk' : 'High Risk'}
          </span>
        </div>
        <div className="risk-meter">
          <div 
            className="risk-fill"
            style={{ width: `${riskLevel}%` }}
          ></div>
        </div>
        <div className="risk-labels">
          <span>Low</span>
          <span>Medium</span>
          <span>High</span>
        </div>
        {trade.isVerified && (
          <div className="amount-display">
            <span>Invoice Amount: ${amount}</span>
          </div>
        )}
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>TradeFi Z 🔐</h1>
            <span>Confidential Trade Finance</span>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Secure Trade Finance Platform</h2>
            <p>Connect your wallet to access encrypted trade finance applications with FHE protection.</p>
            <div className="feature-grid">
              <div className="feature">
                <span>🔐</span>
                <p>FHE Encrypted Invoices</p>
              </div>
              <div className="feature">
                <span>🏦</span>
                <p>Bank Risk Assessment</p>
              </div>
              <div className="feature">
                <span>⚡</span>
                <p>Instant Financing</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing trade data with homomorphic encryption</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading trade finance platform...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>TradeFi Z 🔐</h1>
          <span>Confidential Trade Finance</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="status-btn">
            System Status
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Application
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="content-header">
          <h2>Trade Finance Dashboard</h2>
          <div className="header-controls">
            <div className="search-box">
              <input 
                type="text" 
                placeholder="Search applications..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <select 
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Applications</option>
              <option value="verified">Verified</option>
              <option value="pending">Pending</option>
            </select>
            <button 
              onClick={loadData} 
              className="refresh-btn" 
              disabled={isRefreshing}
            >
              {isRefreshing ? "🔄" : "Refresh"}
            </button>
          </div>
        </div>
        
        {renderStats()}
        
        <div className="applications-section">
          <h3>Trade Applications</h3>
          <div className="applications-grid">
            {filteredData.length === 0 ? (
              <div className="no-applications">
                <p>No trade applications found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Application
                </button>
              </div>
            ) : filteredData.map((trade, index) => (
              <div 
                className={`application-card ${trade.isVerified ? "verified" : "pending"}`}
                key={index}
                onClick={() => setSelectedTrade(trade)}
              >
                <div className="card-header">
                  <h4>{trade.name}</h4>
                  <span className={`status ${trade.isVerified ? "verified" : "pending"}`}>
                    {trade.isVerified ? "✅ Approved" : "⏳ Pending"}
                  </span>
                </div>
                <div className="card-content">
                  <div className="application-info">
                    <span>Application ID: {trade.id.substring(0, 8)}...</span>
                    <span>Created: {new Date(trade.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  {renderRiskChart(trade)}
                </div>
                <div className="card-footer">
                  <span>Creator: {trade.creator.substring(0, 6)}...{trade.creator.substring(38)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateTrade 
          onSubmit={createTrade} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingTrade} 
          tradeData={newTradeData} 
          setTradeData={setNewTradeData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedTrade && (
        <TradeDetailModal 
          trade={selectedTrade} 
          onClose={() => setSelectedTrade(null)} 
          isDecrypting={fheIsDecrypting} 
          decryptData={() => decryptData(selectedTrade.id)}
          renderRiskChart={renderRiskChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </span>
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateTrade: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  tradeData: any;
  setTradeData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, tradeData, setTradeData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'invoiceAmount') {
      const intValue = value.replace(/[^\d]/g, '');
      setTradeData({ ...tradeData, [name]: intValue });
    } else {
      setTradeData({ ...tradeData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-trade-modal">
        <div className="modal-header">
          <h2>New Trade Finance Application</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Protection</strong>
            <p>Invoice amount will be encrypted using homomorphic encryption</p>
          </div>
          
          <div className="form-group">
            <label>Company Name *</label>
            <input 
              type="text" 
              name="companyName" 
              value={tradeData.companyName} 
              onChange={handleChange} 
              placeholder="Enter company name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Invoice Amount (USD) *</label>
            <input 
              type="number" 
              name="invoiceAmount" 
              value={tradeData.invoiceAmount} 
              onChange={handleChange} 
              placeholder="Enter amount..." 
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Transaction Description</label>
            <textarea 
              name="description" 
              value={tradeData.description} 
              onChange={handleChange} 
              placeholder="Describe the trade transaction..."
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !tradeData.companyName || !tradeData.invoiceAmount} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Submitting..." : "Submit Application"}
          </button>
        </div>
      </div>
    </div>
  );
};

const TradeDetailModal: React.FC<{
  trade: TradeFinanceData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderRiskChart: (trade: TradeFinanceData) => JSX.Element;
}> = ({ trade, onClose, isDecrypting, decryptData, renderRiskChart }) => {
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (trade.isVerified) return;
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedAmount(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="trade-detail-modal">
        <div className="modal-header">
          <h2>Trade Application Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="trade-info">
            <div className="info-item">
              <span>Company:</span>
              <strong>{trade.name}</strong>
            </div>
            <div className="info-item">
              <span>Application ID:</span>
              <strong>{trade.id}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{trade.creator.substring(0, 6)}...{trade.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(trade.timestamp * 1000).toLocaleString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Invoice Data</h3>
            
            <div className="encrypted-data">
              <div className="data-row">
                <span>Invoice Amount:</span>
                <strong>
                  {trade.isVerified ? 
                    `$${trade.decryptedValue} (Verified)` : 
                    decryptedAmount ? 
                    `$${decryptedAmount} (Decrypted)` : 
                    "🔒 FHE Encrypted"
                  }
                </strong>
                <button 
                  className={`decrypt-btn ${(trade.isVerified || decryptedAmount) ? 'decrypted' : ''}`}
                  onClick={handleDecrypt} 
                  disabled={isDecrypting || trade.isVerified}
                >
                  {isDecrypting ? "Decrypting..." : 
                   trade.isVerified ? "✅ Verified" : 
                   decryptedAmount ? "🔓 Re-decrypt" : 
                   "🔓 Decrypt Amount"}
                </button>
              </div>
            </div>
            
            <div className="fhe-explanation">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>Homomorphic Encryption</strong>
                <p>Amount is encrypted on-chain using FHE. Banks can assess risk without seeing actual values.</p>
              </div>
            </div>
          </div>
          
          {renderRiskChart(trade)}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!trade.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Processing..." : "Verify Amount"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

