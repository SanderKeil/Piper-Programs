import math

class Vector3:
    def __init__(self, x=0, y=0, z=0):
        self.x = x
        self.y = y
        self.z = z
    
    def __add__(self, other):
        return Vector3(self.x + other.x, self.y + other.y, self.z + other.z)
    
    def __sub__(self, other):
        return Vector3(self.x - other.x, self.y - other.y, self.z - other.z)
    
    def __mul__(self, scalar):
        return Vector3(self.x * scalar, self.y * scalar, self.z * scalar)

    def dot(self, other):
        return self.x * other.x + self.y * other.y + self.z * other.z

    def cross(self, other):
        return Vector3(
            self.y * other.z - self.z * other.y,
            self.z * other.x - self.x * other.z,
            self.x * other.y - self.y * other.x
        )
    
    def norm(self):
        return math.sqrt(self.x**2 + self.y**2 + self.z**2)
    
    def normalize(self):
        n = self.norm()
        if n > 0:
            self.x /= n
            self.y /= n
            self.z /= n
        return self

class Quaternion:
    def __init__(self, w=1, x=0, y=0, z=0):
        self.w = w
        self.x = x
        self.y = y
        self.z = z
    
    @staticmethod
    def from_euler(roll, pitch, yaw):
        # ZYX order
        # roll (X), pitch (Y), yaw (Z)
        # q = qz * qy * qx
        
        c1 = math.cos(yaw / 2)
        c2 = math.cos(pitch / 2)
        c3 = math.cos(roll / 2)
        s1 = math.sin(yaw / 2)
        s2 = math.sin(pitch / 2)
        s3 = math.sin(roll / 2)

        w = c1 * c2 * c3 + s1 * s2 * s3
        x = c1 * c2 * s3 - s1 * s2 * c3
        y = c1 * s2 * c3 + s1 * c2 * s3
        z = s1 * c2 * c3 - c1 * s2 * s3
        return Quaternion(w, x, y, z)
    
    @staticmethod
    def from_matrix(R):
        # R is 3x3 list of lists or 1D list of 9 elements
        # Assuming row-major list of 9 or 3x3
        # Use simpler approach if limited
        pass

    def inverse(self):
        n2 = self.w**2 + self.x**2 + self.y**2 + self.z**2
        return Quaternion(self.w/n2, -self.x/n2, -self.y/n2, -self.z/n2)

    def __mul__(self, other):
        # Quaternion multiplication
        w1, x1, y1, z1 = self.w, self.x, self.y, self.z
        w2, x2, y2, z2 = other.w, other.x, other.y, other.z
        
        w = w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2
        x = w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2
        y = w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2
        z = w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2
        return Quaternion(w, x, y, z)

    def to_list(self):
        return [self.w, self.x, self.y, self.z]

def matrix_multiply(A, B):
    # A: mxn, B: nxp => mxp
    m = len(A)
    n = len(A[0])
    p = len(B[0])
    C = [[0]*p for _ in range(m)]
    for i in range(m):
        for j in range(p):
            for k in range(n):
                C[i][j] += A[i][k] * B[k][j]
    return C

def transpose(A):
    m = len(A)
    n = len(A[0])
    return [[A[j][i] for j in range(m)] for i in range(n)]

def matrix_vector_mul(A, v):
    # v is list
    return [sum(A[i][j]*v[j] for j in range(len(v))) for i in range(len(A))]
