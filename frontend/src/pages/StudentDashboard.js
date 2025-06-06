// frontend/src/pages/StudentDashboard.js
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useWeb3 } from '../contexts/Web3Context';
import axios from 'axios';
import { ethers } from 'ethers';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api/users';

function StudentDashboard() {
  const { user, logout } = useAuth();
  const { contract, address, isConnected, signer, error: web3Error } = useWeb3();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('account');
  const [organizations, setOrganizations] = useState([]);
  const [selectedOrganization, setSelectedOrganization] = useState('');
  const [currentOrgIssuanceFee, setCurrentOrgIssuanceFee] = useState(null); // New state for selected org's issuance fee
  const [fetchOrgFeeLoading, setFetchOrgFeeLoading] = useState(false); // New state for loading fee
  const [fetchOrgFeeError, setFetchOrgFeeError] = useState(null); // New state for fee error

  // New states for credential details
  const [usn, setUsn] = useState('');
  const [yearOfGraduation, setYearOfGraduation] = useState('');
  const [certificateType, setCertificateType] = useState('');

  const [requestStatus, setRequestStatus] = useState(null); // For request submission feedback
  const [studentRequests, setStudentRequests] = useState([]); // All requests made by student
  const [receivedCertificates, setReceivedCertificates] = useState([]); // Issued certificates

  const [loading, setLoading] = useState(false); // General loading for data fetches

  const [searchTerm, setSearchTerm] = useState('');

  // Add validation helpers
  const validateUSN = (usn) => /^[a-zA-Z0-9]{6,20}$/.test(usn);
  const validateYear = (year) => {
    const y = Number(year);
    const current = new Date().getFullYear();
    return y >= 1950 && y <= current + 10;
  };

  // Function to fetch all registered organizations from backend
  const fetchOrganizations = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/organizations`);
      setOrganizations(response.data);
    } catch (err) {
      console.error('Error fetching organizations:', err);
    } finally {
      setLoading(false);
    }
  }, []); // No dependency on user.token

  // Function to fetch all requests made by the student
  const fetchStudentRequests = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/student-requests`, {
        headers: {
          Authorization: `Bearer ${user.token}`,
        },
      });
      setStudentRequests(response.data);
    } catch (err) {
      console.error('Error fetching student requests:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.token]);

  // Function to fetch issued certificates for the student
  const fetchReceivedCertificates = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/received-certificates`, {
        headers: {
          Authorization: `Bearer ${user.token}`,
        },
      });
      setReceivedCertificates(response.data);
    } catch (err) {
      console.error('Error fetching received certificates:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.token]);

  useEffect(() => {
    if (user && user.userType !== 'student') {
      return;
    }
    if (user?.token) {
      fetchOrganizations();
      fetchStudentRequests();
      fetchReceivedCertificates();
    }
  }, [user, fetchOrganizations, fetchStudentRequests, fetchReceivedCertificates]);

  // Effect to fetch issuance fee when a new organization is selected
  useEffect(() => {
    const getOrgIssuanceFee = async () => {
      setFetchOrgFeeLoading(true);
      setFetchOrgFeeError(null);
      setCurrentOrgIssuanceFee(null); // Clear previous fee

      if (!selectedOrganization || !isConnected || !contract) {
        setFetchOrgFeeLoading(false);
        return;
      }

      try {
        const org = organizations.find(o => o._id === selectedOrganization);
        if (org && org.walletAddress) {
          // Call the smart contract to get organization details
          const orgDetails = await contract.organizations(org.walletAddress);
          if (orgDetails && orgDetails.isRegistered) {
            // The issuanceFee is returned as a BigNumber, convert to string and then to CELO
            setCurrentOrgIssuanceFee(ethers.formatEther(orgDetails.issuanceFee));
          } else {
            setFetchOrgFeeError('Selected organization not found on blockchain or not registered.');
          }
        }
      } catch (err) {
        console.error('Error fetching organization issuance fee from blockchain:', err);
        setFetchOrgFeeError(`Failed to fetch fee: ${err.message || err.reason || 'Blockchain error'}`);
      } finally {
        setFetchOrgFeeLoading(false);
      }
    };

    getOrgIssuanceFee();
  }, [selectedOrganization, isConnected, contract, organizations]); // Dependencies for this effect

  // Handle requesting a certificate
  const handleRequestCertificate = async (e) => {
    e.preventDefault();
    setRequestStatus(null);

    if (!isConnected || !address || !signer) {
      toast.error('Please connect your wallet and ensure it is ready.');
      return;
    }
    if (!selectedOrganization) {
      toast.error('Please select an organization.');
      return;
    }
    if (!contract) {
      toast.error('Blockchain contract not loaded. Ensure wallet is connected and on Alfajores.');
      return;
    }
    if (currentOrgIssuanceFee === null) {
      toast.error('Issuance fee not loaded. Please wait or select another organization.');
      return;
    }
    // New validation for credential details
    if (!usn || !validateUSN(usn)) {
      toast.error('Please enter a valid USN (6-20 alphanumeric characters).');
      return;
    }
    if (!yearOfGraduation || !validateYear(yearOfGraduation)) {
      toast.error('Please enter a valid graduation year (1950 to current+10).');
      return;
    }
    if (!certificateType) {
      toast.error('Please select a certificate type.');
      return;
    }

    setLoading(true);
    try {
      const org = organizations.find(o => o._id === selectedOrganization);
      if (!org) {
        toast.error('Selected organization not found.');
        setLoading(false);
        return;
      }

      const issuanceFeeWei = ethers.parseEther(currentOrgIssuanceFee); // Convert CELO to Wei

      if (issuanceFeeWei > 0n) { // Only send transaction if fee is greater than 0
        toast.info(`Initiating payment of ${currentOrgIssuanceFee} CELO to ${org.name}... Please confirm in MetaMask.`);
        console.log(`Sending ${currentOrgIssuanceFee} CELO to ${org.walletAddress}`);

        try {
          const tx = await signer.sendTransaction({
            to: org.walletAddress,
            value: issuanceFeeWei,
          });
          await tx.wait(); // Wait for the transaction to be mined
          toast.success(`Payment of ${currentOrgIssuanceFee} CELO successful! Transaction Hash: ${tx.hash}`);
          console.log('Payment transaction successful:', tx.hash);
        } catch (txError) {
          console.error('Payment transaction failed:', txError);
          toast.error(`Payment failed: ${txError.reason || txError.message}. Request not submitted.`);
          setLoading(false);
          return; // Stop if payment fails
        }
      } else {
        toast.info('No issuance fee required. Proceeding with request submission.');
      }

      // Now, send the request to the backend including new credential details
      const response = await axios.post(`${API_URL}/request-certificate`,
        {
          organizationId: selectedOrganization,
          issuanceAmount: issuanceFeeWei.toString(), // Send fee in Wei as string
          usn,
          yearOfGraduation: parseInt(yearOfGraduation), // Ensure it's sent as a number
          certificateType,
        },
        { headers: { Authorization: `Bearer ${user.token}` } }
      );
      toast.success(response.data.message);
      fetchStudentRequests(); // Refresh requests list
      fetchReceivedCertificates(); // Refresh certificates list
      // Clear form fields after successful submission
      setUsn('');
      setYearOfGraduation('');
      setCertificateType('');
      setSelectedOrganization(''); // Also clear selected organization
    } catch (err) {
      console.error('Error requesting certificate:', err);
      toast.error(err.response?.data?.message || err.message || 'Failed to submit request.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/', { replace: true });
  };

  // Add effect to clear requestStatus after 3 seconds
  useEffect(() => {
    if (requestStatus) {
      const timer = setTimeout(() => setRequestStatus(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [requestStatus]);

  // useEffect for tab switching, depends on activeTab and fetch functions
  useEffect(() => {
    if (activeTab === 'requests') {
      fetchStudentRequests();
    }
    if (activeTab === 'certificates') {
      fetchReceivedCertificates();
    }
  }, [activeTab, fetchStudentRequests, fetchReceivedCertificates]);

  if (!user) {
    return null;
  }

  return (
    <div style={{
      minHeight: '100vh',
      width: '100%',
      background: 'linear-gradient(120deg, #ecebff 0%, #e0f7fa 100%)',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      padding: '0',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 1100,
        margin: '48px 0',
        borderRadius: 32,
        boxShadow: '0 8px 32px var(--shadow-color)',
        background: 'linear-gradient(135deg, #fff 60%, #ecebff 100%)',
        padding: '40px 32px',
        minHeight: 600,
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 32,
        }}>
          <div>
            <h1 style={{ color: 'var(--primary-color)', fontWeight: 900, fontSize: '2.3em', margin: 0, letterSpacing: '-0.5px' }}>
              Welcome {user.name.toUpperCase()}
            </h1>
          </div>
          <button onClick={handleLogout} className="button button-outline" style={{ fontWeight: 700, fontSize: '1.08em', padding: '10px 24px' }}>Logout</button>
        </div>

        {/* Tabs */}
        <div className="tabs" style={{ marginBottom: 32 }}>
          <button className={`tab-button${activeTab === 'account' ? ' active' : ''}`} onClick={() => setActiveTab('account')}>Account</button>
          <button className={`tab-button${activeTab === 'request' ? ' active' : ''}`} onClick={() => setActiveTab('request')}>Request Certificate</button>
          <button className={`tab-button${activeTab === 'requests' ? ' active' : ''}`} onClick={() => setActiveTab('requests')}>My Requests</button>
          <button className={`tab-button${activeTab === 'certificates' ? ' active' : ''}`} onClick={() => setActiveTab('certificates')}>Received Certificates</button>
        </div>

        {/* Alerts */}
        {web3Error && <div className="alert alert-error" style={{ marginBottom: 24 }}>{web3Error}</div>}

        {/* Tab Content */}
        <div>
          {activeTab === 'account' && (
            <div className="card" style={{ marginBottom: 32, borderRadius: 24, boxShadow: '0 4px 24px var(--shadow-color)', padding: '32px 24px', background: 'linear-gradient(135deg, #f8f9fb 60%, #ecebff 100%)' }}>
              <h2 style={{ color: 'var(--primary-color)', fontWeight: 800, fontSize: '1.5em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 28 }}>👤</span> Account Details
              </h2>
              <div style={{ color: '#888', fontSize: '1.08em', marginBottom: 18 }}>
                View and manage your student account information.
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '18px 0 24px 0' }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ fontSize: 22 }}>🧑</span><span style={{ color: 'var(--secondary-color)', fontWeight: 700 }}>Name:</span> <span style={{ marginLeft: 6 }}>{user.name}</span></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ fontSize: 22 }}>📧</span><span style={{ color: 'var(--secondary-color)', fontWeight: 700 }}>Email:</span> <span style={{ marginLeft: 6 }}>{user.email || 'N/A'}</span></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ fontSize: 22 }}>💼</span><span style={{ color: 'var(--secondary-color)', fontWeight: 700 }}>Wallet:</span> <span style={{ marginLeft: 6 }}>{address}</span></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ fontSize: 22 }}>🎓</span><span style={{ color: 'var(--secondary-color)', fontWeight: 700 }}>User Type:</span> <span style={{ marginLeft: 6 }}>Student</span></div>
              </div>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 18 }}>
                <div className="alert" style={{ background: user.isBlockchainRegistered ? '#e0f7fa' : '#fff3e0', color: user.isBlockchainRegistered ? '#155724' : '#b26a00', border: 'none', fontWeight: 700, fontSize: '1.08em', flex: 1 }}>
                  <span style={{ fontSize: 20 }}>{user.isBlockchainRegistered ? '✅' : '⚠️'}</span> Blockchain Registered: {user.isBlockchainRegistered ? 'Yes' : 'No'}
                </div>
                <div className="alert" style={{ background: isConnected ? '#e8f5e9' : '#ffebee', color: isConnected ? '#388e3c' : '#c62828', border: 'none', fontWeight: 700, fontSize: '1.08em', flex: 1 }}>
                  <span style={{ fontSize: 20 }}>{isConnected ? '🔗' : '❌'}</span> Wallet Status: {isConnected ? `Connected (${address ? `${address.substring(0, 6)}...${address.substring(address.length - 4)}` : 'N/A'})` : 'Disconnected'}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'request' && (
            <div className="card" style={{ marginBottom: 32, borderRadius: 24, boxShadow: '0 4px 24px var(--shadow-color)', padding: '32px 24px' }}>
              <h2 style={{ color: 'var(--primary-color)', fontWeight: 800, fontSize: '1.5em', marginBottom: 18 }}>Request Certificate</h2>
              <form onSubmit={handleRequestCertificate}>
                <div className="form-group">
                  <label htmlFor="organization-select">Select Organization:</label>
                  {loading ? (
                    <div className="spinner"></div>
                  ) : (
                    <select
                      id="organization-select"
                      className="input-field"
                      value={selectedOrganization}
                      onChange={(e) => setSelectedOrganization(e.target.value)}
                      required
                      disabled={!isConnected || !address || loading}
                    >
                      <option value="">-- Select an Organization --</option>
                      {organizations.map((org) => (
                        <option key={org._id} value={org._id}>
                          {org.name} ({org.walletAddress.substring(0, 6)}...{org.walletAddress.substring(org.walletAddress.length - 4)})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {selectedOrganization && (
                  <div style={{ marginTop: '15px', marginBottom: '15px' }}>
                    {fetchOrgFeeLoading ? (
                      <div className="spinner"></div>
                    ) : fetchOrgFeeError ? (
                      <div className="alert alert-error">{fetchOrgFeeError}</div>
                    ) : currentOrgIssuanceFee !== null ? (
                      <div className="alert alert-info">
                        Issuance Fee for this Organization: <strong>{currentOrgIssuanceFee} CELO</strong>
                      </div>
                    ) : (
                      <div className="alert alert-info">
                        Select an organization to see its issuance fee.
                      </div>
                    )}
                  </div>
                )}

                {/* New fields for credential details */}
                <div className="form-group">
                  <label htmlFor="userName">Account User Name:</label>
                  <input
                    type="text"
                    id="userName"
                    className="input-field"
                    value={user?.name || ''} // Pre-fill with user's name
                    readOnly // Make it read-only
                    disabled={true} // Always disabled as it's read-only
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="usn">USN (University Seat Number):</label>
                  <input
                    type="text"
                    id="usn"
                    className="input-field"
                    value={usn}
                    onChange={(e) => setUsn(e.target.value)}
                    placeholder="e.g., 1VA19CS001"
                    required
                    disabled={loading || !isConnected || !selectedOrganization}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="yearOfGraduation">Year of Graduation:</label>
                  <input
                    type="number"
                    id="yearOfGraduation"
                    className="input-field"
                    value={yearOfGraduation}
                    onChange={(e) => setYearOfGraduation(e.target.value)}
                    placeholder="e.g., 2023"
                    min="1900" // Sensible minimum year
                    max={new Date().getFullYear() + 10} // Sensible maximum year
                    required
                    disabled={loading || !isConnected || !selectedOrganization}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="certificateType">Type of Certificate:</label>
                  <select
                    id="certificateType"
                    className="input-field"
                    value={certificateType}
                    onChange={(e) => setCertificateType(e.target.value)}
                    required
                    disabled={loading || !isConnected || !selectedOrganization}
                  >
                    <option value="">-- Select Certificate Type --</option>
                    <option value="Degree Certificate">Degree Certificate</option>
                    <option value="Transcript">Transcript</option>
                    <option value="Course Completion">Course Completion</option>
                    <option value="Participation">Participation</option>
                    <option value="Award">Award</option>
                    <option value="Other">Other</option>
                  </select>
                </div>


                <button type="submit" className="button button-primary" disabled={loading || !isConnected || !address || !selectedOrganization || !usn || !yearOfGraduation || !certificateType}>
                  {loading ? <div className="spinner"></div> : 'Submit Request'}
                </button>
              </form>
              {!isConnected && (
                <div className="alert alert-info" style={{ marginTop: '20px' }}>
                  Please connect your wallet to submit a request.
                </div>
              )}
            </div>
          )}

          {activeTab === 'requests' && (
            <div className="card" style={{ marginBottom: 32, borderRadius: 24, boxShadow: '0 4px 24px var(--shadow-color)', padding: '32px 24px' }}>
              <h2 style={{ color: 'var(--primary-color)', fontWeight: 800, fontSize: '1.5em', marginBottom: 18 }}>My Requests</h2>
              <input
                type="text"
                className="input-field"
                placeholder="Search requests..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{ marginBottom: 18, width: '100%', maxWidth: 350 }}
              />
              {loading ? (
                <div className="spinner"></div>
              ) : studentRequests.length === 0 ? (
                <div className="alert alert-info">You have not made any certificate requests yet.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ minWidth: 1100 }}>
                    <thead>
                      <tr>
                        <th>Organization</th>
                        <th>Org Wallet</th>
                        <th>USN</th>
                        <th>Graduation Year</th>
                        <th>Certificate Type</th>
                        <th>Status</th>
                        <th>Issuance Fee (CELO)</th>
                        <th>Remarks</th>
                        <th>Requested On</th>
                        <th>Issued On</th>
                      </tr>
                    </thead>
                    <tbody>
                      {studentRequests.filter(req => {
                        const term = searchTerm.toLowerCase();
                        return (
                          req.organization?.name?.toLowerCase().includes(term) ||
                          req.organization?.walletAddress?.toLowerCase().includes(term) ||
                          (req.usn || '').toLowerCase().includes(term) ||
                          (req.yearOfGraduation || '').toString().includes(term) ||
                          (req.certificateType || '').toLowerCase().includes(term) ||
                          (req.status || '').toLowerCase().includes(term) ||
                          (req.remarks || '').toLowerCase().includes(term) ||
                          (req.createdAt ? new Date(req.createdAt).toLocaleDateString().toLowerCase().includes(term) : false) ||
                          (req.issuedAt ? new Date(req.issuedAt).toLocaleDateString().toLowerCase().includes(term) : false)
                        );
                      }).map((req) => (
                        <tr key={req._id}>
                          <td>{req.organization?.name || 'N/A'}</td>
                          <td>{req.organization?.walletAddress ? `${req.organization.walletAddress.substring(0, 6)}...${req.organization.walletAddress.substring(req.organization.walletAddress.length - 4)}` : 'N/A'}</td>
                          <td>{req.usn || 'N/A'}</td>
                          <td>{req.yearOfGraduation || 'N/A'}</td>
                          <td>{req.certificateType || 'N/A'}</td>
                          <td>{req.status.charAt(0).toUpperCase() + req.status.slice(1)}</td>
                          <td>{ethers.formatEther(req.issuanceAmount || 0)}</td>
                          <td>{req.remarks || 'N/A'}</td>
                          <td>{new Date(req.createdAt).toLocaleDateString()}</td>
                          <td>{req.issuedAt && req.status === 'issued' ? new Date(req.issuedAt).toLocaleDateString() : req.status === 'pending' ? 'Pending' : 'N/A'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'certificates' && (
            <div className="card" style={{ marginBottom: 32, borderRadius: 24, boxShadow: '0 4px 24px var(--shadow-color)', padding: '32px 24px' }}>
              <h2 style={{ color: 'var(--primary-color)', fontWeight: 800, fontSize: '1.5em', marginBottom: 18 }}>Received Certificates</h2>
              {loading ? (
                <div className="spinner"></div>
              ) : receivedCertificates.length === 0 ? (
                <div className="alert alert-info">You have not received any certificates yet.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ minWidth: 700 }}>
                    <thead>
                      <tr>
                        <th>Organization</th>
                        <th>IPFS Hash</th>
                        <th>Issued On</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receivedCertificates.map((cert) => (
                        <tr key={cert._id}>
                          <td>{cert.organization?.name || 'N/A'}</td>
                          <td>
                            {cert.ipfsHash ? (
                              <a
                                href={`https://gateway.pinata.cloud/ipfs/${cert.ipfsHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: 'var(--secondary-color)', textDecoration: 'underline' }}
                              >
                                {cert.ipfsHash}
                              </a>
                            ) : 'N/A'}
                          </td>
                          <td>{cert.issuedAt ? new Date(cert.issuedAt).toLocaleDateString() : 'N/A'}</td>
                          <td>
                            {cert.ipfsHash && (
                              <a
                                href={`${process.env.REACT_APP_BACKEND_URL}/api/ipfs/download/${cert.ipfsHash}`}
                                className="button button-secondary"
                                style={{ padding: '5px 10px', fontSize: '0.9em', marginRight: 8 }}
                              >
                                Download
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default StudentDashboard;

