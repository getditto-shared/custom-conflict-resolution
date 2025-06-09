import React from 'react';

export type Role = 'Senior' | 'Junior';

interface UserRoleProps {
  currentRole: Role;
  onRoleChange: (role: Role) => void;
}

const UserRole: React.FC<UserRoleProps> = ({ currentRole, onRoleChange }) => {
  const handleRoleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onRoleChange(event.target.value as Role);
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow-md mb-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">User Role</h3>
        </div>
        <select
          value={currentRole}
          onChange={handleRoleChange}
          className="px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="Junior">Junior</option>
          <option value="Senior">Senior</option>
        </select>
      </div>
    </div>
  );
};

export default UserRole;
