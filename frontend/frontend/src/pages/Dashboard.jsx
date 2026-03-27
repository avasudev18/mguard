import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getVehicles, createVehicle, deleteVehicle } from '../services/api';

export default function Dashboard() {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    year: new Date().getFullYear(),
    make: '',
    model: '',
    trim: '',
    nickname: '',
    current_mileage: ''
  });

  useEffect(() => {
    loadVehicles();
  }, []);

  const loadVehicles = async () => {
    try {
      const response = await getVehicles();
      setVehicles(response.data);
    } catch (error) {
      console.error('Failed to load vehicles:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await createVehicle({
        ...formData,
        current_mileage: formData.current_mileage ? parseInt(formData.current_mileage) : null
      });
      setShowAddForm(false);
      setFormData({
        year: new Date().getFullYear(),
        make: '',
        model: '',
        trim: '',
        nickname: '',
        current_mileage: ''
      });
      loadVehicles();
    } catch (error) {
      console.error('Failed to create vehicle:', error);
      alert('Failed to create vehicle. Please try again.');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this vehicle?')) return;
    
    try {
      await deleteVehicle(id);
      loadVehicles();
    } catch (error) {
      console.error('Failed to delete vehicle:', error);
      alert('Failed to delete vehicle. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">Loading vehicles...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white rounded-lg shadow-xl p-8 mb-8">
        <h1 className="text-4xl font-bold mb-4">Welcome to MaintenanceGuard</h1>
        <p className="text-xl text-blue-100">
          Track your vehicle maintenance, detect unnecessary upsells, and get evidence-based recommendations.
        </p>
      </div>

      {/* Vehicles Section */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Your Vehicles</h2>
        <button
          onClick={() => setShowAddForm(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-semibold transition shadow-md"
        >
          + Add Vehicle
        </button>
      </div>

      {/* Add Vehicle Form */}
      {showAddForm && (
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h3 className="text-xl font-bold mb-4">Add New Vehicle</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Year *</label>
              <input
                type="number"
                required
                min="1900"
                max="2030"
                value={formData.year}
                onChange={(e) => setFormData({...formData, year: parseInt(e.target.value)})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Make *</label>
              <input
                type="text"
                required
                value={formData.make}
                onChange={(e) => setFormData({...formData, make: e.target.value})}
                placeholder="e.g., Toyota"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Model *</label>
              <input
                type="text"
                required
                value={formData.model}
                onChange={(e) => setFormData({...formData, model: e.target.value})}
                placeholder="e.g., Camry"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Trim</label>
              <input
                type="text"
                value={formData.trim}
                onChange={(e) => setFormData({...formData, trim: e.target.value})}
                placeholder="e.g., LE"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nickname</label>
              <input
                type="text"
                value={formData.nickname}
                onChange={(e) => setFormData({...formData, nickname: e.target.value})}
                placeholder="e.g., Mom's Car"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Current Mileage</label>
              <input
                type="number"
                value={formData.current_mileage}
                onChange={(e) => setFormData({...formData, current_mileage: e.target.value})}
                placeholder="e.g., 45000"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="md:col-span-2 flex gap-3">
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md font-semibold transition"
              >
                Add Vehicle
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="bg-gray-300 hover:bg-gray-400 text-gray-800 px-6 py-2 rounded-md font-semibold transition"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Vehicles Grid */}
      {vehicles.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <svg className="mx-auto h-16 w-16 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No vehicles yet</h3>
          <p className="text-gray-500 mb-4">Get started by adding your first vehicle.</p>
          <button
            onClick={() => setShowAddForm(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-semibold transition"
          >
            Add Your First Vehicle
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {vehicles.map((vehicle) => (
            <div key={vehicle.id} className="bg-white rounded-lg shadow-md hover:shadow-lg transition p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-800">
                    {vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                  </h3>
                  {vehicle.nickname && (
                    <p className="text-sm text-gray-600">{vehicle.year} {vehicle.make} {vehicle.model}</p>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(vehicle.id)}
                  className="text-red-600 hover:text-red-800"
                  title="Delete vehicle"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
              
              {vehicle.current_mileage && (
                <p className="text-gray-600 mb-4">
                  <span className="font-semibold">Mileage:</span> {vehicle.current_mileage.toLocaleString()} miles
                </p>
              )}
              
              <div className="flex flex-wrap gap-2">
                <Link
                  to={`/vehicle/${vehicle.id}/upload`}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-center font-semibold transition text-sm"
                >
                  Upload Invoice
                </Link>
                <Link
                  to={`/vehicle/${vehicle.id}/recommendations`}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-center font-semibold transition text-sm"
                >
                  Recommendations
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
