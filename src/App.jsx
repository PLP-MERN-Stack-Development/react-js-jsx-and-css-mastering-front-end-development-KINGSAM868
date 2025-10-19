import React, { useState, useEffect, useCallback, useContext } from 'react';

// --- Firestore/Firebase Imports (Mandatory) ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, addDoc } from 'firebase/firestore';

// --- Firebase Initialization and User State ---
const useFirebaseInit = () => {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    try {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
      const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

      if (!firebaseConfig || !firebaseConfig.apiKey) {
        console.error("Firebase configuration is missing or invalid.");
        return;
      }

      const app = initializeApp(firebaseConfig);
      const firestoreDb = getFirestore(app);
      const firebaseAuth = getAuth(app);

      setDb(firestoreDb);
      setAuth(firebaseAuth);

      const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        if (user) {
          setUserId(user.uid);
        } else {
          // Attempt custom sign-in or anonymous sign-in
          try {
            if (initialAuthToken) {
              await signInWithCustomToken(firebaseAuth, initialAuthToken);
            } else {
              await signInAnonymously(firebaseAuth);
            }
          } catch (e) {
            console.error("Firebase Auth Error:", e);
            // Fallback to random ID if sign-in fails
            setUserId(crypto.randomUUID()); 
          }
        }
        setIsAuthReady(true);
      });

      return () => unsubscribe();
    } catch (e) {
      console.error("Error initializing Firebase:", e);
    }
  }, []);

  return { db, auth, userId, isAuthReady };
};


// --- Task Structure ---
let nextTaskId = 0; // Simple increment for new task IDs

// --- Custom Hook: useTaskPersistence (Using Firestore) ---
const useTaskPersistence = (db, userId, isAuthReady) => {
  const [tasks, setTasks] = useState([]);
  const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

  const getCollectionRef = useCallback(() => {
    if (db && userId) {
      // Private data path: /artifacts/{appId}/users/{userId}/tasks
      return collection(db, `artifacts/${appId}/users/${userId}/tasks`);
    }
    return null;
  }, [db, userId, appId]);

  // 1. Load tasks (using onSnapshot for real-time updates)
  useEffect(() => {
    if (!db || !userId || !isAuthReady) return;

    const tasksCollectionRef = getCollectionRef();
    if (!tasksCollectionRef) return;

    // Fetch and sort data in memory to avoid Firestore index issues
    const q = query(tasksCollectionRef);

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loadedTasks = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Sort tasks by creation timestamp (or by completed status if needed)
      loadedTasks.sort((a, b) => a.timestamp?.toMillis() - b.timestamp?.toMillis());
      
      setTasks(loadedTasks);
      
      // Ensure local ID counter is above the highest existing ID
      const maxId = loadedTasks.reduce((max, task) => Math.max(max, parseInt(task.id) || 0), 0);
      nextTaskId = maxId + 1;
      
    }, (error) => {
      console.error("Firestore Task Snapshot Error:", error);
    });

    return () => unsubscribe();
  }, [db, userId, isAuthReady, getCollectionRef]);


  // 2. CRUD Operations
  const addTask = useCallback(async (text) => {
    const tasksCollectionRef = getCollectionRef();
    if (!tasksCollectionRef) return;

    try {
      const newTask = {
        text: text,
        completed: false,
        timestamp: new Date() // Add server timestamp
      };
      
      // Use addDoc for a new document with an auto-generated ID
      await addDoc(tasksCollectionRef, newTask);
    } catch (e) {
      console.error("Error adding document: ", e);
    }
  }, [getCollectionRef]);

  const toggleTask = useCallback(async (id) => {
    const tasksCollectionRef = getCollectionRef();
    if (!tasksCollectionRef) return;
    
    const taskDocRef = doc(tasksCollectionRef, id);
    const taskToUpdate = tasks.find(t => t.id === id);

    if (taskToUpdate) {
      try {
        // Update Firestore with the new completed status
        await updateDoc(taskDocRef, {
          completed: !taskToUpdate.completed
        });
      } catch (e) {
        console.error("Error updating document: ", e);
      }
    }
  }, [getCollectionRef, tasks]);

  const deleteTask = useCallback(async (id) => {
    const tasksCollectionRef = getCollectionRef();
    if (!tasksCollectionRef) return;
    
    const taskDocRef = doc(tasksCollectionRef, id);
    try {
      await deleteDoc(taskDocRef);
    } catch (e) {
      console.error("Error deleting document: ", e);
    }
  }, [getCollectionRef]);

  return { tasks, addTask, toggleTask, deleteTask, isReady: isAuthReady };
};


// --- Theme Context and Provider (Task 3: useContext & Task 5: dark mode) ---
const ThemeContext = React.createContext();

const ThemeProvider = ({ children }) => {
  // Use 'system' preference for initial load
  const [isDarkMode, setIsDarkMode] = useState(window.matchMedia('(prefers-color-scheme: dark)').matches);

  const toggleTheme = useCallback(() => {
    setIsDarkMode(prevMode => !prevMode);
  }, []);

  // Sync state with DOM class
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  return (
    <ThemeContext.Provider value={{ isDarkMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

const useTheme = () => useContext(ThemeContext);


// --- Reusable UI Component: Button (Task 2) ---
const Button = ({ children, variant = 'primary', onClick, disabled = false, className = '' }) => {
  const baseStyle = "px-6 py-2 rounded-lg font-semibold transition duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";

  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500 shadow-md hover:shadow-lg",
    secondary: "bg-gray-200 text-gray-800 hover:bg-gray-300 focus:ring-gray-500 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600",
    danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 shadow-md hover:shadow-lg",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseStyle} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
};

// --- Reusable UI Component: Card (Task 2) ---
const Card = ({ children, className = '' }) => (
  <div className={`bg-white dark:bg-gray-800 shadow-xl rounded-xl p-6 ${className}`}>
    {children}
  </div>
);

// --- Reusable UI Component: Navbar (Task 2) ---
const Navbar = ({ activeSection, setActiveSection }) => {
  const { isDarkMode, toggleTheme } = useTheme();

  const navItemClass = (section) => 
    `px-3 py-1 text-sm font-medium rounded-full cursor-pointer transition-colors 
     ${activeSection === section 
        ? 'bg-indigo-500 text-white shadow-md' 
        : 'text-gray-600 hover:text-indigo-600 dark:text-gray-300 dark:hover:text-indigo-400'
     }`;

  return (
    <Card className="rounded-none sm:rounded-xl shadow-lg w-full max-w-full mb-6">
      <div className="flex justify-between items-center py-2">
        <h1 className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
          React Assignment App
        </h1>
        <div className="flex items-center space-x-4">
          <nav className="flex space-x-2">
            <div 
              className={navItemClass('tasks')}
              onClick={() => setActiveSection('tasks')}
            >
              Task Manager
            </div>
            <div 
              className={navItemClass('api')}
              onClick={() => setActiveSection('api')}
            >
              API Data
            </div>
          </nav>
          <Button 
            variant="secondary" 
            onClick={toggleTheme}
            className="p-2 w-10 h-10 flex items-center justify-center text-lg"
            title="Toggle Theme"
          >
            {isDarkMode ? '🌞' : '🌙'}
          </Button>
        </div>
      </div>
    </Card>
  );
};

// --- Reusable UI Component: Footer (Task 2) ---
const Footer = () => (
  <footer className="w-full mt-12 py-4 border-t border-gray-200 dark:border-gray-700">
    <div className="max-w-4xl mx-auto text-center text-xs text-gray-500 dark:text-gray-400">
      <p>&copy; {new Date().getFullYear()} React Assignment. All rights reserved.</p>
      <p className="mt-1">
        Built with React, Hooks, and Tailwind CSS. Data persistence via Firestore.
      </p>
    </div>
  </footer>
);

// --- Reusable Component: Loading Spinner ---
const LoadingSpinner = () => (
  <div className="flex items-center justify-center py-8">
    <div className="w-8 h-8 border-4 border-indigo-300 border-t-indigo-600 rounded-full animate-spin"></div>
    <span className="text-indigo-600 dark:text-indigo-400 ml-3">Loading Data...</span>
  </div>
);


// --- TaskManager Component (Task 3: State Management & CRUD) ---
const TaskManager = ({ db, userId, isAuthReady }) => {
  const { tasks, addTask, toggleTask, deleteTask, isReady } = useTaskPersistence(db, userId, isAuthReady);
  const [newTaskText, setNewTaskText] = useState('');
  const [filter, setFilter] = useState('All'); // All, Active, Completed

  const handleAddTask = (e) => {
    e.preventDefault();
    if (newTaskText.trim()) {
      addTask(newTaskText.trim());
      setNewTaskText('');
    }
  };

  const filteredTasks = tasks.filter(task => {
    if (filter === 'Completed') return task.completed;
    if (filter === 'Active') return !task.completed;
    return true;
  });

  const filterButtonClass = (buttonFilter) => 
    `px-4 py-1 text-sm rounded-full transition-colors 
     ${filter === buttonFilter 
        ? 'bg-indigo-500 text-white' 
        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
     }`;

  return (
    <Card className="w-full">
      <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-white">Task Manager (Firestore Persistence)</h2>
      
      {!isReady && <p className="text-orange-500 mb-4">Initializing user and database connection...</p>}
      {isReady && <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">User ID: {userId}</p>}

      {/* Input Form */}
      <form onSubmit={handleAddTask} className="flex space-x-2 mb-6">
        <input
          type="text"
          value={newTaskText}
          onChange={(e) => setNewTaskText(e.target.value)}
          placeholder="Add a new task..."
          className="flex-grow p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:ring-indigo-500 focus:border-indigo-500"
          disabled={!isReady}
        />
        <Button 
          type="submit" 
          variant="primary" 
          disabled={!isReady || !newTaskText.trim()}
        >
          Add Task
        </Button>
      </form>

      {/* Filter Buttons */}
      <div className="flex space-x-3 mb-6">
        <button className={filterButtonClass('All')} onClick={() => setFilter('All')}>All</button>
        <button className={filterButtonClass('Active')} onClick={() => setFilter('Active')}>Active</button>
        <button className={filterButtonClass('Completed')} onClick={() => setFilter('Completed')}>Completed</button>
      </div>

      {/* Task List */}
      <div className="space-y-3">
        {filteredTasks.length === 0 && (
          <p className="text-gray-500 dark:text-gray-400 italic">No tasks found for this filter.</p>
        )}
        {filteredTasks.map(task => (
          <div key={task.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg transition-shadow hover:shadow-sm">
            <div 
              className={`flex-grow cursor-pointer ${task.completed ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-white'}`}
              onClick={() => toggleTask(task.id)}
            >
              {task.text}
            </div>
            <Button 
              variant="danger" 
              onClick={() => deleteTask(task.id)}
              className="ml-4 px-3 py-1 text-xs"
            >
              Delete
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
};


// --- APIFetcher Component (Task 4: API Integration) ---
const APIFetcher = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  // Base API for JSONPlaceholder posts
  const API_URL = 'https://jsonplaceholder.typicode.com/posts';

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(API_URL);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      setData(result);
    } catch (e) {
      setError("Failed to fetch data from API. Please check the network.");
      console.error("API Fetch Error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter and Search Logic
  const filteredData = data.filter(item => 
    item.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
    item.body.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Pagination Logic
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentData = filteredData.slice(startIndex, startIndex + itemsPerPage);

  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };
  
  const renderPagination = () => (
    <div className="flex justify-center items-center space-x-2 mt-6">
      <Button 
        variant="secondary" 
        onClick={() => handlePageChange(currentPage - 1)} 
        disabled={currentPage === 1}
      >
        Previous
      </Button>
      <span className="text-gray-700 dark:text-gray-300 text-sm">
        Page {currentPage} of {totalPages}
      </span>
      <Button 
        variant="secondary" 
        onClick={() => handlePageChange(currentPage + 1)} 
        disabled={currentPage === totalPages}
      >
        Next
      </Button>
    </div>
  );

  return (
    <Card className="w-full">
      <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-white">API Data Viewer (JSONPlaceholder Posts)</h2>
      
      {/* Search Feature */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search by title or body..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setCurrentPage(1); // Reset page on search
          }}
          className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>

      {loading && <LoadingSpinner />}
      {error && <p className="text-red-500 p-4 bg-red-100 dark:bg-red-900 rounded-lg">{error}</p>}
      
      {!loading && !error && (
        <>
          <div className="space-y-4">
            {currentData.map(post => (
              <div key={post.id} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-700/50 transition-shadow hover:shadow-md">
                <h3 className="text-lg font-semibold text-indigo-600 dark:text-indigo-400 mb-1 capitalize">{post.title}</h3>
                <p className="text-gray-600 dark:text-gray-300 text-sm">{post.body}</p>
                <span className="text-xs text-gray-400 mt-2 block">User ID: {post.userId}</span>
              </div>
            ))}
          </div>
          {renderPagination()}
        </>
      )}
    </Card>
  );
};


// --- Layout Component (Task 2) ---
const Layout = ({ children, activeSection, setActiveSection }) => {
  return (
    <div className="min-h-screen flex flex-col items-center bg-gray-50 dark:bg-gray-900 transition-colors duration-300">
      <div className="w-full">
        <Navbar activeSection={activeSection} setActiveSection={setActiveSection} />
      </div>
      <main className="flex-grow w-full max-w-4xl p-4 sm:p-6">
        {children}
      </main>
      <Footer />
    </div>
  );
};


// --- Main Application Component (App.jsx) ---
const App = () => {
  const { db, userId, isAuthReady } = useFirebaseInit();
  const [activeSection, setActiveSection] = useState('tasks'); // Default to Task Manager

  let MainContent;
  if (activeSection === 'tasks') {
    // Task Manager requires DB connection details
    MainContent = <TaskManager db={db} userId={userId} isAuthReady={isAuthReady} />;
  } else if (activeSection === 'api') {
    // API Fetcher is independent of the DB
    MainContent = <APIFetcher />;
  }

  return (
    <ThemeProvider>
      <Layout activeSection={activeSection} setActiveSection={setActiveSection}>
        {MainContent}
      </Layout>
    </ThemeProvider>
  );
};

export default App;
