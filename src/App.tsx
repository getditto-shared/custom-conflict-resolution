import {
  Ditto,
  IdentityOnlinePlayground,
  StoreObserver,
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
  const tasksOverridesObserver = useRef<StoreObserver | null>(null);

  const [syncActive, setSyncActive] = useState<boolean>(true);
  const [promisedInitialization, setPromisedInitialization] =
    useState<Promise<void> | null>(null);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [userRole, setUserRole] = useState<Role>('Junior');

  const [materializedViewTasks, setMaterializedViewTasks] = useState<Task[] | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskOverrides, setTaskOverrides] = useState<Task[]>([]);

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

        // Register subscriptions for both collections
         ditto.current.sync.registerSubscription(
          'SELECT * FROM tasks',
        );

        // Register subscriptions for both collections
        ditto.current.sync.registerSubscription(
          'SELECT * FROM tasks_overrides',
        );

        // Register observer for senior tasks
        tasksOverridesObserver.current =ditto.current.store.registerObserver<Task>(
          'SELECT * FROM tasks_overrides WHERE deleted=false',
          (overrides) => {
            const results = overrides.items.map((item) => item.value);
            setTaskOverrides(results);
          }
        );

        // Register observer for junior tasks
        tasksObserver.current = ditto.current.store.registerObserver<Task>(
          'SELECT * FROM tasks WHERE deleted=false', 
          (results) => {
            const tasks = results.items.map((item) => item.value);
            setTasks(tasks);
          }
        );

        setIsInitialized(true);
      } catch (e) {
        setError(e as Error);
        setIsInitialized(false);
      }

      return () => {
        ditto.current?.close();
        ditto.current = null;
      };
    })();
  }, [promisedInitialization]);

  // Combine and resolve conflicts whenever junior or senior tasks change
  useEffect(() => {
    const taskMap = new Map<string, Task>();
    
    // Add regular tasks first
    tasks.forEach(task => {
      taskMap.set(task._id, task);
    });
    
    // Override tasks always win, regardless of metadata
    taskOverrides.forEach(task => {
      taskMap.set(task._id, task);
    });
    
    const resolvedTasks = Array.from(taskMap.values()).sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return 0;
    });
    
    setMaterializedViewTasks(resolvedTasks);
  }, [tasks, taskOverrides]);

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
      const collection = userRole === 'Senior' ? 'tasks_overrides' : 'tasks';
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
      const collection = userRole === 'Senior' ? 'tasks_overrides' : 'tasks';
      
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
      const collection = userRole === 'Senior' ? 'tasks_overrides' : 'tasks';
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
      const collection = userRole === 'Senior' ? 'tasks_overrides' : 'tasks';
      
      await ditto.current?.store.execute(
        `UPDATE ${collection} SET deleted=true, lastModifiedBy=:lastModifiedBy, lastModifiedAt=:lastModifiedAt WHERE _id=:id`,
        {
          id: task._id,
          lastModifiedBy: userRole,
          lastModifiedAt: Date.now(),
        },
      );
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  const handleRoleChange = (newRole: Role) => {
    setUserRole(newRole);
    console.log('User role changed to:', newRole);
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
        <UserRole currentRole={userRole} onRoleChange={handleRoleChange} />
        <TaskList
          tasks={materializedViewTasks}
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
