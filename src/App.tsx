import {
  Ditto,
  IdentityOnlinePlayground,
  StoreObserver,
  SyncSubscription,
  init,
} from '@dittolive/ditto';
import './App.css';
import DittoInfo from './components/DittoInfo';
import { useEffect, useRef, useState } from 'react';
import TaskList from './components/TaskList';
import UserRole, { Role } from './components/UserRole';

const identity: IdentityOnlinePlayground = {
  type: 'onlinePlayground',
  appID: import.meta.env.DITTO_APP_ID,
  token: import.meta.env.DITTO_PLAYGROUND_TOKEN,
  customAuthURL: import.meta.env.DITTO_AUTH_URL,
  enableDittoCloudSync: false,
};

export type Task = {
  _id: string;
  title: string;
  done: boolean;
  deleted: boolean;
  createdBy: Role;
  lastModifiedBy: Role;
  lastModifiedAt: number;
};

const App = () => {
  const [error, setError] = useState<Error | null>(null);
  const ditto = useRef<Ditto | null>(null);
  const tasksObserver = useRef<StoreObserver | null>(null);
  const seniorObserver = useRef<StoreObserver | null>(null);
  const allTasksObserver = useRef<StoreObserver | null>(null);
  const leaderElectionObserver = useRef<StoreObserver | null>(null);

  const [syncActive, setSyncActive] = useState<boolean>(true);
  const [promisedInitialization, setPromisedInitialization] =
    useState<Promise<void> | null>(null);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [userRole, setUserRole] = useState<Role>('Junior');

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [juniorTasks, setJuniorTasks] = useState<Task[]>([]);
  const [seniorTasks, setSeniorTasks] = useState<Task[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  
  const [currentLeader, setCurrentLeader] = useState<any>(null);
  const [myDeviceId, setMyDeviceId] = useState<string>('');

  const heartbeatInterval = useRef<NodeJS.Timeout | null>(null);
  const leaderCheckInterval = useRef<NodeJS.Timeout | null>(null);
  const leaderDutiesInterval = useRef<NodeJS.Timeout | null>(null);

  const HEARTBEAT_UPDATE_INTERVAL_MS = 1000; // 1 seconds
  const HEARTBEAT_TIMEOUT_MS = 5000; // 5 seconds
  const LEADER_CHECK_INTERVAL_MS = 5000; // 5 seconds
  const LEADER_DUTIES_INTERVAL_MS = 2000; // 2 seconds

  const userRoleRef = useRef<Role>('Junior');
  const juniorTasksRef = useRef<Task[]>([]);
  const seniorTasksRef = useRef<Task[]>([]);

  useEffect(() => {
    const initializeDitto = async () => {
      try {
        await init();
      } catch (e) {
        console.error('Failed to initialize Ditto:', e);
      }
    };

    if (!promisedInitialization) setPromisedInitialization(initializeDitto());
  }, [promisedInitialization]);

  useEffect(() => {
    if (!promisedInitialization) return;

    (async () => {
      await promisedInitialization;
      try {
        // Create a new Ditto instance with the identity
        // https://docs.ditto.live/sdk/latest/install-guides/js#integrating-ditto-and-starting-sync
        ditto.current = new Ditto(identity);

        // Initialize transport config
        ditto.current.updateTransportConfig((config) => {
          config.connect.websocketURLs = [import.meta.env.DITTO_WEBSOCKET_URL];
          return config;
        });

        // disable sync with v3 peers, required for DQL
        await ditto.current.disableSyncWithV3();
        ditto.current.startSync();

        // Get device ID
        const deviceId = ditto.current.presence.graph.localPeer.peerKeyString;
        setMyDeviceId(deviceId);

        // Register subscriptions for all collections
        ditto.current.sync.registerSubscription('SELECT * FROM junior_tasks');
        ditto.current.sync.registerSubscription('SELECT * FROM senior_tasks');
        ditto.current.sync.registerSubscription('SELECT * FROM all_tasks');
        ditto.current.sync.registerSubscription('SELECT * FROM leader_election');

        // Register observers
        seniorObserver.current = ditto.current.store.registerObserver<Task>(
          'SELECT * FROM senior_tasks',
          (senior_results) => {
            const seniors = senior_results.items.map((item) => item.value);
            setSeniorTasks(seniors);
            console.log('senior tasks:', seniors);
            seniorTasksRef.current = seniors;
          }
        );

        tasksObserver.current = ditto.current.store.registerObserver<Task>(
          'SELECT * FROM junior_tasks', 
          (junior_results) => {
            const juniors = junior_results.items.map((item) => item.value);
            setJuniorTasks(juniors);
            console.log('junior tasks:', juniors);
            juniorTasksRef.current = juniors;
          }
        );

        allTasksObserver.current = ditto.current.store.registerObserver<Task>(
          'SELECT * FROM all_tasks WHERE deleted=false',
          (all_results) => {
            const all = all_results.items.map((item) => item.value);
            setAllTasks(all);
          }
        );

        // Join leader election
        await joinLeaderElection(deviceId);

        // Start heartbeat
        startHeartbeat(deviceId);

        setIsInitialized(true);
      } catch (e) {
        setError(e as Error);
        setIsInitialized(false);
      }

      return () => {
        if (heartbeatInterval.current) clearInterval(heartbeatInterval.current);
        if (leaderCheckInterval.current) clearInterval(leaderCheckInterval.current);
        if (leaderDutiesInterval.current) clearInterval(leaderDutiesInterval.current);
        ditto.current?.close();
        ditto.current = null;
      };
    })();
  }, [promisedInitialization]);

  // Start leader election check only after device ID is available
  useEffect(() => {
    if (myDeviceId && isInitialized) {
      startLeaderElectionCheck();
    }
  }, [myDeviceId, isInitialized]);

  const joinLeaderElection = async (deviceId: string) => {
    const currentTimeStamp = Date.now();
    const leaderCandidateEntry = {
      "_id": deviceId,
      "priority": userRole === 'Senior' ? 5 : 2, // Senior has higher priority
      "initial_timestamp": currentTimeStamp,
      "heartbeat_timestamp": currentTimeStamp
    };

    try {
      await ditto.current?.store.execute(
        "INSERT INTO leader_election DOCUMENTS (:leaderCandidateEntry) ON ID CONFLICT DO UPDATE",
        { leaderCandidateEntry }
      );
    } catch (error) {
      console.error('Failed to join leader election:', error);
    }
  };

  const startHeartbeat = (deviceId: string) => {
    heartbeatInterval.current = setInterval(async () => {
      try {
        await ditto.current?.store.execute(
          `UPDATE leader_election SET heartbeat_timestamp = :now, priority = :priority WHERE _id = :myDeviceId`,
          {
            now: Date.now(),
            myDeviceId: deviceId,
            priority: userRoleRef.current === 'Senior' ? 5 : 2, // Use ref instead
          }
        );
      } catch (error) {
        console.error('Failed to update heartbeat:', error);
      }
      console.log('Heartbeat updated for device:', deviceId, userRoleRef.current);
    }, HEARTBEAT_UPDATE_INTERVAL_MS);
  };

  const electLeader = (candidates: any[]) => {
    if (candidates.length === 0) return null;
    
    // Sort by priority DESC, initial_timestamp ASC, _id ASC
    candidates.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      if (a.initial_timestamp !== b.initial_timestamp) return a.initial_timestamp - b.initial_timestamp;
      return a._id.localeCompare(b._id);
    });
    
    return candidates[0];
  };

  const checkAndElectLeader = async () => {
    try {
      const response = await ditto.current?.store.execute(
        `SELECT * FROM leader_election WHERE priority > 0 AND heartbeat_timestamp > :heartbeat_cutoff_timestamp`,
        {
          heartbeat_cutoff_timestamp: Date.now() - HEARTBEAT_TIMEOUT_MS
        }
      );

      const currentCandidates = response?.items.map(a => a.value) || [];
      const newLeader = electLeader(currentCandidates);
      const newLeaderId = newLeader?._id || null;

      // Return if the leader hasn't changed
      if (newLeaderId === currentLeader?._id) return;

      if (newLeaderId) {
        console.log(`New leader elected: ${newLeaderId}`);
      } else {
        console.warn(`No eligible leader found.`);
      }
      console.log(newLeaderId, myDeviceId, currentLeader?._id)

      if (newLeaderId === myDeviceId) {
        // I'm the new leader, assume duties
        executeLeaderDuties();
      } else if (currentLeader?._id === myDeviceId) {
        // I'm no longer the leader, pause leader duties
        pauseLeaderDutiesIfRunning();
      }

      setCurrentLeader(newLeader);
    } catch (error) {
      console.error('Failed to check leader election:', error);
    }
  };

  const startLeaderElectionCheck = () => {
    leaderCheckInterval.current = setInterval(() => {
      checkAndElectLeader();
    }, LEADER_CHECK_INTERVAL_MS);
  };

  const executeLeaderDuties = () => {
    if (leaderDutiesInterval.current) return; // Already running
    
    leaderDutiesInterval.current = setInterval(async () => {
      try {
        // Create a map to resolve conflicts between senior and junior tasks
        const taskMap = new Map<string, Task>();
        console.log('Executing leader duties...');
        
        // Add junior tasks first
        juniorTasksRef.current.forEach(task => {
          taskMap.set(task._id, task);
        });
        
        // Add senior tasks, overriding junior tasks with same ID (senior wins)
        seniorTasksRef.current.forEach(task => {
          taskMap.set(task._id, task);
        });
        
        // Sync resolved tasks to all_tasks
        for (const task of taskMap.values()) {
          await ditto.current?.store.execute(
            'INSERT INTO all_tasks DOCUMENTS (:task) ON ID CONFLICT DO UPDATE',
            { task }
          );
        }
      } catch (error) {
        console.error('Failed to execute leader duties:', error);
      }
    }, LEADER_DUTIES_INTERVAL_MS);
  };

  const pauseLeaderDutiesIfRunning = () => {
    if (leaderDutiesInterval.current) {
      clearInterval(leaderDutiesInterval.current);
      leaderDutiesInterval.current = null;
    }
  };

  // Update role change to rejoin election with new priority
  const handleRoleChange = async (newRole: Role) => {
    setUserRole(newRole);
    userRoleRef.current = newRole; // Update ref
    console.log('User role changed to:', newRole);
    
    if (myDeviceId) {
      await joinLeaderElection(myDeviceId);
    }
  };

  // Use all_tasks for rendering instead of combined junior/senior tasks
  useEffect(() => {
    const resolvedTasks = allTasks.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return 0;
    });
    
    setTasks(resolvedTasks);
  }, [allTasks]);

  const toggleSync = () => {
    if (syncActive) {
      ditto.current?.stopSync();
    } else {
      ditto.current?.startSync();
    }
    setSyncActive(!syncActive);
  };

  // https://docs.ditto.live/sdk/latest/crud/create
  const createTask = async (title: string) => {
    try {
      const collection = userRole === 'Senior' ? 'senior_tasks' : 'junior_tasks';
      await ditto.current?.store.execute(
        `INSERT INTO ${collection} DOCUMENTS (:task)`,
        {
          task: {
            title,
            done: false,
            deleted: false,
            createdBy: userRole,
            lastModifiedBy: userRole,
            lastModifiedAt: Date.now(),
          },
        },
      );
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  };

  // https://docs.ditto.live/sdk/latest/crud/update
  const editTask = async (id: string, title: string) => {
    try {
      const collection = userRole === 'Senior' ? 'senior_tasks' : 'junior_tasks';
      
      await ditto.current?.store.execute(
        `INSERT INTO ${collection} DOCUMENTS (:task) ON ID CONFLICT DO UPDATE`,
        {
          task: {
            _id: id,
            title,
            done: false,
            deleted: false,
            createdBy: userRole,
            lastModifiedBy: userRole,
            lastModifiedAt: Date.now()
          }
        },
      );
    } catch (error) {
      console.error('Failed to edit task:', error);
    }
  };

  const toggleTask = async (task: Task) => {
    try {
      const collection = userRole === 'Senior' ? 'senior_tasks' : 'junior_tasks';
      await ditto.current?.store.execute(
        `UPDATE ${collection} SET done=:done, lastModifiedBy=:lastModifiedBy, lastModifiedAt=:lastModifiedAt WHERE _id=:id`,
        {
          id: task._id,
          done: !task.done,
          lastModifiedBy: userRole,
          lastModifiedAt: Date.now(),
        },
      );
    } catch (error) {
      console.error('Failed to toggle task:', error);
    }
  };

  // https://docs.ditto.live/sdk/latest/crud/delete#soft-delete-pattern
  const deleteTask = async (task: Task) => {
    try {
      const collection = userRole === 'Senior' ? 'senior_tasks' : 'junior_tasks';
      
      await ditto.current?.store.execute(
        `UPDATE ${collection} SET deleted=true, lastModifiedBy=:lastModifiedBy, lastModifiedAt=:lastModifiedAt WHERE _id=:id`,
        {
          id: task._id,
          lastModifiedBy: userRole,
          lastModifiedAt: Date.now(),
        },
      );
    } catch (error) {
      console.error('Failed to edit task:', error);
    }
  };

  const ErrorMessage: React.FC<{ error: Error }> = ({ error }) => {
    const [dismissed, setDismissed] = useState(false);
    if (dismissed) return null;

    return (
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-red-100 text-red-700 p-6 rounded shadow-lg">
        <div className="flex justify-between items-center">
          <p>
            <b>Error</b>: {error.message}
          </p>
          <button
            onClick={() => setDismissed(true)}
            className="ml-4 text-red-700 hover:text-red-900"
          >
            &times;
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="h-screen w-full bg-gray-100">
      <div className="h-full w-full flex flex-col container mx-auto items-center">
        {error && <ErrorMessage error={error} />}
        <DittoInfo
          appId={identity.appID}
          token={identity.token}
          syncEnabled={syncActive}
          onToggleSync={toggleSync}
          isInitialized={isInitialized}
        />
        <div className="bg-white p-4 rounded-lg shadow-md mb-4 w-full max-w-md">
          <div className="flex flex-col space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">
                Leader: {currentLeader?._id?.slice(-8) || 'None'}
              </span>
              <span className={`text-sm px-2 py-1 rounded ${currentLeader?._id === myDeviceId ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                {currentLeader?._id === myDeviceId ? 'Leader' : 'Follower'}
              </span>
            </div>
            <div className="text-xs text-gray-500">
              My ID: {myDeviceId.slice(-8) || 'Loading...'}
            </div>
          </div>
        </div>
        <UserRole currentRole={userRole} onRoleChange={handleRoleChange} />
        <TaskList
          tasks={tasks}
          onCreate={createTask}
          onEdit={editTask}
          onToggle={toggleTask}
          onDelete={deleteTask}
          isInitialized={isInitialized}
        />
      </div>
    </div>
  );
};

export default App;
